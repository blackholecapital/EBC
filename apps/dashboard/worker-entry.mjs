/**
 * Cloudflare Module Worker entrypoint.
 * API/webhook surface + queue consumers.
 */

import runtime from "./shared/runtime/index.js";
runtime.override("edge");

import { routeRequest } from "./backend/edge-router.js";
import env from "./shared/env/index.js";
import logger from "./shared/logger/index.js";
import metrics from "./shared/metrics/index.js";
import permissions from "./shared/permissions/index.js";
import db from "./backend/layers/core/db.js";
import d1Cached from "./backend/layers/core/d1-cached-store.js";
import queue from "./shared/queue/index.js";
import cfQueueBackend from "./shared/queue/cf-queue-backend.js";
import memoryStore from "./backend/layers/core/memory-store.js";
import contacts from "./backend/layers/domain/contacts.js";
import templates from "./backend/layers/domain/templates.js";
import buddyEvents from "./backend/layers/domain/buddy-events.js";
import campaignSendJob from "./worker/jobs/campaign-send/index.js";
import followupCheckJob from "./worker/jobs/followup-check/index.js";
import { hydrateSharedSecrets } from "../shared/cloudflare-secrets.mjs";

const SHARED_SECRET_MAPPINGS = [
  { target:"LIVEKIT_API_KEY", binding:"SHARED_LIVEKIT_API_KEY" },
  { target:"LIVEKIT_API_SECRET", binding:"SHARED_LIVEKIT_API_SECRET" },
  { target:"ZOOM_ACCOUNT_ID", binding:"SHARED_ZOOM_ACCOUNT_ID" },
  { target:"ZOOM_CLIENT_ID", binding:"SHARED_ZOOM_CLIENT_ID" },
  { target:"ZOOM_CLIENT_SECRET", binding:"SHARED_ZOOM_CLIENT_SECRET" },
];

let memoryBackendSet = false;

function tenantContext(workerEnv, source = {}) {
  const payload = source?.payload || {};
  const contact = payload?.contact || source?.contact || {};
  return {
    tenantId:String(source.tenantId || payload.tenantId || workerEnv.TENANT_ID || "blackhole"),
    corporateId:String(source.corporateId || payload.corporateId || workerEnv.CORPORATE_ID || workerEnv.TENANT_ID || "blackhole"),
    locationId:String(
      source.locationId || source.location_id || payload.locationId || payload.location_id ||
      contact.locationId || contact.location_id || workerEnv.DEFAULT_LOCATION_ID || "corporate"
    ),
  };
}

function writeAnalytics(workerEnv, event, status, durationMs = 0) {
  if (!workerEnv.ANALYTICS) return;
  const tenant = tenantContext(workerEnv, event);
  try {
    workerEnv.ANALYTICS.writeDataPoint({
      blobs:[String(event.type || "unknown"), String(status || ""), tenant.tenantId, tenant.corporateId, tenant.locationId],
      doubles:[Date.now(), Number(durationMs || 0)],
      indexes:[tenant.tenantId],
    });
  } catch (error) {
    logger.warn("Analytics write failed", { type:event.type || "unknown", error:error.message });
  }
}

async function archiveEvents(workerEnv, events) {
  if (!workerEnv.TENANT_ARCHIVE || !events.length) return;
  const tenant = tenantContext(workerEnv, events[0]);
  const datePath = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
  const key = `tenants/${tenant.tenantId}/events/${datePath}/batch-${Date.now()}-${crypto.randomUUID()}.ndjson`;
  const body = `${events.map(event => JSON.stringify(event)).join("\n")}\n`;
  await workerEnv.TENANT_ARCHIVE.put(key, body, {
    httpMetadata:{ contentType:"application/x-ndjson" },
    customMetadata:{
      tenantId:tenant.tenantId,
      corporateId:tenant.corporateId,
      eventCount:String(events.length),
    },
  });
}

async function initPersistence(workerEnv) {
  if (workerEnv.DB) {
    d1Cached.setDb(workerEnv.DB);
    await d1Cached.load(workerEnv.DB);
    db.setBackend(d1Cached);
  } else if (!memoryBackendSet) {
    db.setBackend(memoryStore);
    memoryBackendSet = true;
  }
}

function initQueue(workerEnv) {
  if (workerEnv.FOLLOWUP_QUEUE) {
    cfQueueBackend.setBinding(workerEnv.FOLLOWUP_QUEUE);
    queue.setBackend(cfQueueBackend);
  }
}

function ensureSeed() {
  const data = db.readDb();
  if (!data.contacts.length) contacts.create({ firstName:"Alex", lastName:"Buyer", phone:"+15550000001", email:"alex@example.com", channelPreference:"sms" });
  if (!data.templates.length) {
    templates.create({ name:"Initial check-in", channel:"sms", body:"Hi {{firstName}}, checking in on your request." });
    templates.create({ name:"Follow-up nudge", channel:"sms", body:"Hi {{firstName}}, following up in case you missed my last note." });
  }
}

function jsonResponse(status, payload, correlationId, requestId, workerEnv, source = {}) {
  const tenant = tenantContext(workerEnv || {}, source);
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers:{
      "Content-Type":"application/json",
      "Access-Control-Allow-Origin":"*",
      "X-Correlation-Id":correlationId || "",
      "X-Request-Id":requestId || "",
      "X-Tenant-Id":tenant.tenantId,
      "X-Corporate-Id":tenant.corporateId,
      "X-Location-Id":tenant.locationId,
    },
  });
}

function htmlResponse(status, html, correlationId, requestId, workerEnv, source = {}) {
  const tenant = tenantContext(workerEnv || {}, source);
  return new Response(String(html || ""), {
    status,
    headers:{
      "Content-Type":"text/html; charset=utf-8",
      "Cache-Control":"private, no-store, max-age=0",
      "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy":"no-referrer",
      "X-Content-Type-Options":"nosniff",
      "X-Correlation-Id":correlationId || "",
      "X-Request-Id":requestId || "",
      "X-Tenant-Id":tenant.tenantId,
      "X-Corporate-Id":tenant.corporateId,
      "X-Location-Id":tenant.locationId,
    },
  });
}

export default {
  async fetch(request, workerEnv, ctx) {
    workerEnv = await hydrateSharedSecrets(workerEnv, SHARED_SECRET_MAPPINGS);
    env.setBindings(workerEnv);
    await initPersistence(workerEnv);
    initQueue(workerEnv);

    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status:204, headers:{
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type,Authorization,X-Correlation-Id,X-Tenant-Id,X-Corporate-Id,X-Location-Id",
      }});
    }

    if (!pathname.startsWith("/api/") && !pathname.startsWith("/webhooks/")) return workerEnv.ASSETS.fetch(request);

    const correlationId = request.headers.get("x-correlation-id") || logger.generateCorrelationId();
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
    const requestStartedAt = Date.now();

    const response = await logger.withContext({ correlationId, requestId }, async () => {
      metrics.increment("http.requests");
      const headersObj = {};
      request.headers.forEach((v,k)=>{ headersObj[k]=v; });
      const authResult = permissions.enforce(method, pathname, headersObj);
      const requestScope = { locationId:request.headers.get("x-location-id") || workerEnv.DEFAULT_LOCATION_ID };
      if (!authResult.allowed) return jsonResponse(403, { ok:false, error:authResult.error }, correlationId, requestId, workerEnv, requestScope);

      const queryObj = {};
      searchParams.forEach((v,k)=>{ queryObj[k]=v; });
      const match = routeRequest(pathname, method, queryObj, headersObj);
      if (!match) return jsonResponse(404, { ok:false, error:"Route not found" }, correlationId, requestId, workerEnv, requestScope);

      try {
        let body = {};
        if (method !== "GET" && method !== "HEAD") {
          try { body = await request.json(); } catch { body = {}; }
        }
        const result = await match.fn({ method, body, params:match.params, user:authResult.user, env:workerEnv });
        if (result?.responseType === "html") {
          const status = Number(result.status || (result.ok ? 200 : 400));
          metrics.increment("http.responses." + status);
          return htmlResponse(status, result.html, correlationId, requestId, workerEnv, requestScope);
        }
        const status = result.ok ? 200 : 400;
        metrics.increment("http.responses." + status);
        return jsonResponse(status, result, correlationId, requestId, workerEnv, requestScope);
      } catch (err) {
        metrics.increment("http.errors");
        logger.error("Handler error", { method, path:pathname, error:err.message });
        return jsonResponse(500, { ok:false, error:"Internal server error" }, correlationId, requestId, workerEnv, requestScope);
      }
    });

    writeAnalytics(workerEnv, { type:`http.${method.toLowerCase()}`, locationId:request.headers.get("x-location-id") || workerEnv.DEFAULT_LOCATION_ID }, String(response.status), Date.now() - requestStartedAt);
    if (d1Cached.isDirty() && workerEnv.DB) ctx.waitUntil(d1Cached.flush());
    return response;
  },

  async queue(batch, workerEnv, ctx) {
    workerEnv = await hydrateSharedSecrets(workerEnv, SHARED_SECRET_MAPPINGS);
    env.setBindings(workerEnv);
    await initPersistence(workerEnv);

    const processed = [];
    const eventsDb = workerEnv.EVENTS_DB || workerEnv.BUDDY_DB;
    for (const msg of batch.messages) {
      const receivedAt = Date.now();
      const sourceJob = msg.body || {};
      const job = { ...sourceJob, ...tenantContext(workerEnv, sourceJob) };
      try {
        if (job.type === "campaign-send") {
          await campaignSendJob.run();
        } else if (job.type === "followup-check") {
          await followupCheckJob.run();
        } else if (eventsDb && job.type) {
          await buddyEvents.record(eventsDb, job);
        } else {
          logger.warn("Unknown queue message", { type:job.type || "unknown" });
        }
        msg.ack();
        processed.push(job);
        writeAnalytics(workerEnv, job, "processed", Date.now() - receivedAt);
        metrics.increment("queue.processed");
      } catch (err) {
        msg.retry();
        writeAnalytics(workerEnv, job, "retry", Date.now() - receivedAt);
        metrics.increment("queue.failed");
        logger.error("Queue message failed", { type:job.type || "unknown", error:err.message });
      }
    }

    if (processed.length) {
      try { await archiveEvents(workerEnv, processed); }
      catch (error) { logger.error("Tenant archive write failed", { eventCount:processed.length, error:error.message }); }
    }

    if (d1Cached.isDirty() && workerEnv.DB) await d1Cached.flush();
  },
};
