require("dotenv").config();
const axios = require("axios");
const { Resend } = require("resend");
const { query } = require("../db/pool");
const ws = require("../sockets");

// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);

const CONFIG = {
  frontend: process.env.FRONTEND_URL || "http://localhost:3000",
  emailTo: process.env.ALERT_EMAIL_TO,
};

const isEmailConfigured = () =>
  !!process.env.RESEND_API_KEY && !!CONFIG.emailTo;

const isSlackConfigured = () =>
  !!process.env.SLACK_WEBHOOK_URL &&
  !process.env.SLACK_WEBHOOK_URL.includes("REPLACE");

// ─────────────────────────────────────────────────────────
// SLACK SERVICE
// ─────────────────────────────────────────────────────────

async function sendSlack(type, incident, flow, failedStep, durationMs) {
  if (!isSlackConfigured()) return false;

  const isCritical = incident.severity === "critical";
  const emoji = isCritical ? "🔴" : "🟡";

  try {
    if (type === "alert") {
      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        text: `${emoji} *Syntrix Alert — ${incident.title}*`,
      });
      console.log("✓ Slack alert sent");
    }

    if (type === "resolved") {
      const sec = Math.round(durationMs / 1000);
      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        text: `✅ Resolved — ${flow.name} (${sec}s)`,
      });
      console.log("✓ Slack resolved sent");
    }

    return true;
  } catch (err) {
    console.error("Slack error:", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// EMAIL SERVICE (RESEND)
// ─────────────────────────────────────────────────────────

function buildEmailHtml(incident, flow, failedStep) {
  const isCritical = incident.severity === "critical";

  const accent = isCritical ? "#FF3D54" : "#FFC107";
  const label = isCritical ? "CRITICAL FAILURE" : "DEGRADED PERFORMANCE";
  const dash = process.env.FRONTEND_URL || "http://localhost:3000";

  return `
  <body style="margin:0;padding:0;background:#0b0f14;font-family:Inter,Segoe UI,Arial,sans-serif;">
    <div style="max-width:640px;margin:40px auto;background:#0f1720;border:1px solid #1e2c38;border-radius:10px;overflow:hidden">

      <!-- HEADER -->
      <div style="padding:20px 24px;border-bottom:1px solid #1e2c38">
        <div style="color:#00d4ff;font-size:22px;font-weight:800">⬡ Syntrix</div>
        <div style="margin-top:10px;display:inline-block;padding:6px 12px;
          border-radius:6px;
          background:${accent}20;
          color:${accent};
          font-size:11px;
          font-weight:700;
          letter-spacing:1px;">
          ${label}
        </div>
      </div>

      <!-- BODY -->
      <div style="padding:24px">

        <h2 style="color:#fff;font-size:18px;margin-bottom:20px;">
          ${incident.title}
        </h2>

        ${gridItem("FLOW", flow.name)}
        ${gridItem("TYPE", flow.type.toUpperCase())}
        ${gridItem(
          "FAILED STEP",
          failedStep?.name
            ? `${failedStep.position}. ${failedStep.name}`
            : "Step info unavailable"
        )}
        ${gridItem("DETECTED", new Date().toUTCString())}
        ${gridItem("SEVERITY", incident.severity.toUpperCase())}
        ${gridItem("INTERVAL", `Every ${flow.interval_s}s`)}

        <!-- BUTTONS -->
        <div style="margin-top:28px;text-align:center;">
          <a href="${dash}/flows/${flow.id}"
             style="background:#FFC107;color:#000;
             padding:12px 22px;border-radius:6px;
             font-weight:700;text-decoration:none;margin-right:10px;">
             View Flow Dashboard
          </a>

          <a href="${dash}/incidents/${incident.id}"
             style="border:1px solid #FFC107;
             color:#FFC107;
             padding:12px 22px;border-radius:6px;
             font-weight:700;text-decoration:none;">
             View Incident
          </a>
        </div>

      </div>
    </div>
  </body>
  `;
}

function gridItem(label, value) {
  return `
    <div style="background:#0b131a;
      border:1px solid #1e2c38;
      border-radius:6px;
      padding:12px;
      margin-bottom:10px;">
      
      <div style="font-size:10px;
        letter-spacing:1.5px;
        color:#4a657a;
        margin-bottom:4px;">
        ${label}
      </div>

      <div style="color:#c8d8e8;
        font-weight:600;
        font-size:14px;">
        ${value}
      </div>
    </div>
  `;
}

async function sendEmail(type, incident, flow, failedStep) {
  if (!isEmailConfigured()) {
    console.log("⚠ Email not configured");
    return false;
  }

  console.log("📧 Sending email...");

  try {
    await resend.emails.send({
      from: "Syntrix <onboarding@resend.dev>",
      to: CONFIG.emailTo,
      subject:
        type === "alert"
          ? `[ALERT] ${incident.title}`
          : `[RESOLVED] ${flow.name}`,
      html: buildEmailHtml(incident, flow, failedStep),
    });

    console.log("✓ Email sent");
    return true;
  } catch (err) {
    console.error("❌ Email failed:", err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// INCIDENT LOGIC
// ─────────────────────────────────────────────────────────

async function handleFailure(run, flow, steps, failedStepResult) {
  const failedStep = failedStepResult
    ? steps.find((s) => s.id === failedStepResult.step_id)
    : null;

  const severity = run.status === "failed" ? "critical" : "warning";

  const title = `${flow.name} — ${
    failedStep
      ? `Step ${failedStep.position} failed`
      : "Execution failed"
  }`;

  // Check existing
  const { rows: existing } = await query(
    `SELECT * FROM incidents WHERE flow_id=$1 AND status='open' LIMIT 1`,
    [flow.id]
  );

  if (existing.length) return existing[0];

  const { rows: [incident] } = await query(
    `INSERT INTO incidents
     (flow_id, failed_step_id, run_id, status, severity, title)
     VALUES ($1,$2,$3,'open',$4,$5)
     RETURNING *`,
    [flow.id, failedStep?.id ?? null, run.id, severity, title]
  );

  // 🔥 Send alerts
  await Promise.all([
    sendSlack("alert", incident, flow, failedStep),
    sendEmail("alert", incident, flow, failedStep),
  ]);

  ws.incidentOpened(incident, flow);

  return incident;
}

async function handleRecovery(flow, run) {
  const { rows: open } = await query(
    `SELECT * FROM incidents WHERE flow_id=$1 AND status='open'`,
    [flow.id]
  );

  for (const incident of open) {
    const durationMs =
      Date.now() - new Date(incident.opened_at).getTime();

    await query(
      `UPDATE incidents SET status='resolved', resolved_at=NOW()
       WHERE id=$1`,
      [incident.id]
    );

    // 🔥 Send both alerts (VERY IMPORTANT FOR DEMO)
    await Promise.all([
      sendSlack("resolved", incident, flow, null, durationMs),
      sendEmail("resolved", incident, flow, null),
    ]);

    ws.incidentResolved(incident, flow);
  }
}

// ─────────────────────────────────────────────────────────

module.exports = {
  handleFailure,
  handleRecovery,
};