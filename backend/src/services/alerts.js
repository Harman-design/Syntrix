// backend/src/services/alerts.js
// Handles the full alert lifecycle:
//   handleFailure()   — called when a run fails/degrades
//   handleRecovery()  — called when a previously-failed flow passes again

require("dotenv").config();
const axios = require("axios");
const { query } = require("../db/pool");
const ws = require("../sockets");

// ── Email transport ───────────────────────────────────────────────────────
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const isEmailConfigured = () =>
  !!process.env.RESEND_API_KEY && !!process.env.ALERT_EMAIL_TO;
const isSlackConfigured = () =>
  !!process.env.SLACK_WEBHOOK_URL &&
  !process.env.SLACK_WEBHOOK_URL.includes("REPLACE");

// ─────────────────────────────────────────────────────────────────────────────
//  SLACK
// ─────────────────────────────────────────────────────────────────────────────

async function sendSlackAlert(incident, flow, failedStep) {
  if (!isSlackConfigured()) {
    console.log("[Alerts] Slack not configured — skipping.");
    return false;
  }

  const isCritical = incident.severity === "critical";
  const emoji = isCritical ? "🔴" : "🟡";
  const color = isCritical ? "#FF3D54" : "#FFCA28";
  const dashboardUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}`;

  const payload = {
    text: `${emoji} *Syntrix Alert — ${incident.title}*`,
    attachments: [
      {
        color,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${emoji} *${incident.severity.toUpperCase()}: ${incident.title}*`,
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Flow:*\n${flow.name}` },
              { type: "mrkdwn", text: `*Type:*\n${flow.type.toUpperCase()}` },
              {
                type: "mrkdwn",
                text: failedStep
                  ? `*Failed at step:*\n${failedStep.position}. ${failedStep.name}`
                  : `*Failed step:*\nUnknown`,
              },
              {
                type: "mrkdwn",
                text: `*Detected:*\n<!date^${Math.floor(Date.now() / 1000)}^{time_secs} on {date_short}|${new Date().toISOString()}>`,
              },
            ],
          },
          ...(incident.description
            ? [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*Error:*\n\`\`\`${incident.description.substring(0, 500)}\`\`\``,
                  },
                },
              ]
            : []),
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "🔍 View Flow" },
                url: `${dashboardUrl}/flows/${flow.id}`,
                style: isCritical ? "danger" : "primary",
              },
              {
                type: "button",
                text: { type: "plain_text", text: "📋 Incident" },
                url: `${dashboardUrl}/incidents/${incident.id}`,
              },
            ],
          },
          { type: "divider" },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Syntrix Synthetic Monitor · <${dashboardUrl}|Open Dashboard>`,
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, payload, { timeout: 5000 });
    console.log(`[Alerts] ✓ Slack alert sent for incident ${incident.id}`);
    return true;
  } catch (err) {
    console.error("[Alerts] Slack send failed:", err.message);
    return false;
  }
}

async function sendSlackResolution(incident, flow, durationMs) {
  if (!isSlackConfigured()) return false;

  const s = Math.round(durationMs / 1000);
  const dur =
    s > 3600
      ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
      : s > 60
        ? `${Math.floor(s / 60)}m ${s % 60}s`
        : `${s}s`;

  try {
    await axios.post(
      process.env.SLACK_WEBHOOK_URL,
      {
        text: `✅ *Syntrix Resolved — ${flow.name}*`,
        attachments: [
          {
            color: "#00E676",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: `✅ *Resolved: ${flow.name}*` },
              },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: `*Flow:*\n${flow.name}` },
                  { type: "mrkdwn", text: `*Incident duration:*\n${dur}` },
                  { type: "mrkdwn", text: `*Status:*\nAll steps passing ✓` },
                  {
                    type: "mrkdwn",
                    text: `*Resolved at:*\n${new Date().toUTCString()}`,
                  },
                ],
              },
            ],
          },
        ],
      },
      { timeout: 5000 },
    );
    console.log(`[Alerts] ✓ Slack resolution sent for ${flow.name}`);
    return true;
  } catch (err) {
    console.error("[Alerts] Slack resolution failed:", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EMAIL
// ─────────────────────────────────────────────────────────────────────────────

function buildEmailHtml(incident, flow, failedStep) {
  const isCritical = incident.severity === "critical";
  const accent = isCritical ? "#FF3D54" : "#FFCA28";
  const label = isCritical ? "CRITICAL FAILURE" : "DEGRADED PERFORMANCE";
  const dash = process.env.FRONTEND_URL || "http://localhost:3000";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080c10;font-family:'Segoe UI',Arial,sans-serif;color:#c8d8e8">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">

  <!-- Header -->
  <div style="background:#111820;border:1px solid #1e2c38;border-radius:8px 8px 0 0;padding:24px;border-top:3px solid ${accent}">
    <div style="font-size:22px;font-weight:900;color:#00d4ff;letter-spacing:-1px;margin-bottom:6px">⬡ Syntrix</div>
    <span style="display:inline-block;background:${accent}20;color:${accent};border:1px solid ${accent}40;padding:4px 12px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:2px">${label}</span>
  </div>

  <!-- Body -->
  <div style="background:#111820;border:1px solid #1e2c38;border-top:none;padding:24px">
    <h2 style="color:#fff;font-size:17px;margin:0 0 20px">${incident.title}</h2>

    <!-- Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      ${[
        ["Flow", flow.name],
        ["Type", flow.type.toUpperCase()],
        [
          "Failed Step",
          failedStep ? `${failedStep.position}. ${failedStep.name}` : "—",
        ],
        ["Detected", new Date().toUTCString()],
        ["Severity", incident.severity.toUpperCase()],
        ["Interval", `Every ${flow.interval_s}s`],
      ]
        .map(
          ([label, val]) => `
        <div style="background:#0d1318;border:1px solid #1e2c38;border-radius:6px;padding:12px">
          <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#3a5060;margin-bottom:4px">${label}</div>
          <div style="font-size:13px;color:#c8d8e8;font-weight:600">${val}</div>
        </div>`,
        )
        .join("")}
    </div>

    ${
      incident.description
        ? `
    <!-- Error block -->
    <div style="background:#05090d;border:1px solid rgba(255,61,84,0.2);border-left:3px solid #ff3d54;border-radius:4px;padding:12px;margin-bottom:20px">
      <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#3a5060;margin-bottom:6px">Error Detail</div>
      <pre style="font-family:monospace;font-size:11px;color:#ff3d54;white-space:pre-wrap;word-break:break-all;margin:0">${incident.description.substring(0, 600)}</pre>
    </div>`
        : ""
    }

    <!-- CTA -->
    <div style="text-align:center;margin-top:24px">
      <a href="${dash}/flows/${flow.id}"
         style="display:inline-block;background:${accent};color:#000;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:13px;margin:0 6px">
        View Flow Dashboard
      </a>
      <a href="${dash}/incidents/${incident.id}"
         style="display:inline-block;background:transparent;color:${accent};text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:13px;border:1px solid ${accent}40">
        View Incident
      </a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#080c10;border:1px solid #1e2c38;border-top:none;border-radius:0 0 8px 8px;padding:14px;text-align:center;font-size:10px;color:#3a5060">
    Syntrix Synthetic Transaction Monitor · Auto-generated alert · Do not reply
  </div>
</div>
</body>
</html>`;
}

async function sendEmailAlert(incident, flow, failedStep) {
  if (!isEmailConfigured()) {
    console.log("[Alerts] Email not configured — skipping.");
    return false;
  }

  try {
    await resend.emails.send({
      from: "Syntrix Alerts <onboarding@syntrix-fawn.vercel.app>", // test sender
      to: process.env.ALERT_EMAIL_TO,
      subject: `[Syntrix ${incident.severity.toUpperCase()}] ${incident.title}`,
      html: buildEmailHtml(incident, flow, failedStep),
    });
    console.log(`[Alerts] ✓ Email sent to ${process.env.ALERT_EMAIL_TO}`);
    return true;
  } catch (err) {
    console.error("[Alerts] Email failed:", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  INCIDENT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called by runs.js after a failed/degraded run.
 * Creates or updates an incident, dispatches alerts respecting cooldown.
 */
async function handleFailure(run, flow, steps, failedStepResult) {
  const failedStep = failedStepResult
    ? steps.find((s) => s.id === failedStepResult.step_id)
    : null;

  const severity = run.status === "failed" ? "critical" : "warning";

  const title = `${flow.name} — ${
    failedStep
      ? `Step ${failedStep.position} failed: ${failedStep.name}`
      : "Execution failed"
  }`;

  // Check for an existing open incident
  const { rows: existing } = await query(
    `SELECT * FROM incidents WHERE flow_id = $1 AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [flow.id],
  );

  const cooldown = parseInt(process.env.ALERT_COOLDOWN_SECONDS || "300");

  if (existing.length > 0) {
    const inc = existing[0];
    const sinceAlert = inc.alert_sent_at
      ? (Date.now() - new Date(inc.alert_sent_at).getTime()) / 1000
      : Infinity;

    // Update description with latest error
    await query(
      `UPDATE incidents SET description = $1, run_id = $2 WHERE id = $3`,
      [failedStepResult?.error, run.id, inc.id],
    );

    if (sinceAlert < cooldown) {
      console.log(
        `[Alerts] Cooldown active (${Math.round(sinceAlert)}s) — skipping re-alert`,
      );
      return inc;
    }
  }

  // Create a new incident record
  const {
    rows: [incident],
  } = await query(
    `INSERT INTO incidents
       (flow_id, failed_step_id, run_id, status, severity, title, description, alert_channels)
     VALUES ($1,$2,$3,'open',$4,$5,$6,'{}') RETURNING *`,
    [
      flow.id,
      failedStep?.id ?? null,
      run.id,
      severity,
      title,
      failedStepResult?.error ?? null,
    ],
  );

  // Dispatch alerts in parallel
  const [slackOk, emailOk] = await Promise.all([
    sendSlackAlert(incident, flow, failedStep),
    sendEmailAlert(incident, flow, failedStep),
  ]);

  const channels = [slackOk && "slack", emailOk && "email"].filter(Boolean);
  await query(
    `UPDATE incidents SET alert_sent_at = NOW(), alert_channels = $1 WHERE id = $2`,
    [channels, incident.id],
  );

  // Notify dashboard via WebSocket
  ws.incidentOpened(incident, flow);

  return incident;
}

/**
 * Called by runs.js when a previously-failing flow passes again.
 * Resolves open incidents and sends resolution notices.
 */
async function handleRecovery(flow, run) {
  const { rows: open } = await query(
    `SELECT * FROM incidents WHERE flow_id = $1 AND status = 'open'`,
    [flow.id],
  );

  for (const incident of open) {
    const durationMs = Date.now() - new Date(incident.opened_at).getTime();

    await query(
      `UPDATE incidents
       SET status = 'resolved', resolved_at = NOW(), resolution_run_id = $1
       WHERE id = $2`,
      [run.id, incident.id],
    );

    await Promise.allSettled([sendSlackResolution(incident, flow, durationMs)]);

    ws.incidentResolved(incident, flow);
    console.log(
      `[Alerts] ✓ Incident ${incident.id} resolved after ${Math.round(durationMs / 1000)}s`,
    );
  }
}

module.exports = { handleFailure, handleRecovery };
