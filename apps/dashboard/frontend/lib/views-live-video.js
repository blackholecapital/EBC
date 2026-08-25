/* Live video customer-service launch surface. */

function renderLiveVideo() {
  return `
    <div class="page-header">
      <div>
        <h2>Live Video Chat</h2>
        <div class="table-meta">Start a Zoom room and send EILA in as a live avatar participant.</div>
      </div>
    </div>
    <div class="card-grid">
      <section class="card">
        <div class="card-header"><h3>Start customer video service</h3><span class="badge badge-success">EILA ready</span></div>
        <form id="live-video-form">
          <div class="form-group">
            <label class="form-label" for="live-video-topic">Meeting topic</label>
            <input class="input" id="live-video-topic" name="topic" value="Everything Built Custom live customer service" maxlength="120" />
          </div>
          <div class="form-group">
            <label class="form-label" for="live-video-url">Existing Zoom link <span class="table-meta">(optional)</span></label>
            <input class="input" id="live-video-url" name="meetingUrl" type="url" placeholder="Leave blank to create a new Zoom room" />
            <div class="form-hint">Paste an existing Zoom invite, or let Everything Built Custom create one.</div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit" id="start-live-video">Start live video chat</button>
          </div>
        </form>
      </section>
      <section class="card">
        <div class="card-header"><h3>What happens next</h3></div>
        <div class="live-feed">
          <div class="live-feed-item"><strong>1. Zoom opens</strong><span class="table-meta">The customer enters a standard Zoom meeting.</span></div>
          <div class="live-feed-item"><strong>2. EILA joins</strong><span class="table-meta">LiveKit dispatches the running LemonSlice agent into that room.</span></div>
          <div class="live-feed-item"><strong>3. Voice and video stay synchronized</strong><span class="table-meta">The shared EILA runtime supplies her established voice.</span></div>
        </div>
        <div id="live-video-result" style="margin-top:var(--sp-3)" aria-live="polite"></div>
      </section>
    </div>`;
}

function bindLiveVideoForm() {
  const form = document.getElementById("live-video-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("start-live-video");
    const pendingWindow = window.open("about:blank", "_blank");
    if (pendingWindow) pendingWindow.document.title = "Preparing EILA video chat";

    await withLoading(button, async () => {
      const values = formData(form);
      const result = await api("/api/live-video", "POST", {
        topic: values.topic,
        meetingUrl: values.meetingUrl,
      });
      if (!result.ok) {
        if (pendingWindow) pendingWindow.close();
        return;
      }

      const joinUrl = result.data?.joinUrl;
      if (pendingWindow && joinUrl) pendingWindow.location.replace(joinUrl);
      else if (joinUrl) window.open(joinUrl, "_blank", "noopener,noreferrer");

      const target = document.getElementById("live-video-result");
      if (target) target.innerHTML = `<div class="badge badge-success">EILA dispatched</div>
        <p class="table-meta" style="margin-top:var(--sp-2)">Room ${esc(result.data.room)} is starting. If Zoom did not open, <a href="${esc(joinUrl)}" target="_blank" rel="noopener noreferrer">join it here</a>.</p>`;
      toast("EILA is joining the Zoom room", "success");
    });
  });
}

window.renderLiveVideo = renderLiveVideo;
window.bindLiveVideoForm = bindLiveVideoForm;
