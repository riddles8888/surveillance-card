import {
  css,
  html,
  LitElement,
} from "https://unpkg.com/lit-element@2.3.1/lit-element.js?module";

class SurveillanceCard extends LitElement {
  render() {
    if (!this.cameras) {
      return html`<div class="loading">Loading Cameras...</div>`;
    }

    const screenWidth = (window.innerWidth > 0) ? window.innerWidth : screen.width;
    let screenSizeClass = "";

    if (screenWidth < 520) screenSizeClass = "tinyScreen";
    else if (screenWidth < 1000) screenSizeClass = "smallScreen";

    const showToolbarClass = (!this.isMobileApp && this.showCaptureButtons) ? "" : "hidden";

    return html`
      <div class="container thumbs-${this.thumbPosition}">
        <div class="thumbs">
          ${this.cameras.filter((c) => c.access_token).map((camera) => {
            let thumbClass = camera.has_motion ? "thumb motion" : "thumb";
            thumbClass += camera === this.selectedCamera ? " selected" : "";

            return html`
              <div class="${thumbClass}" @click="${() => this._updateSelectedCamera(camera)}">
                <img src="${camera.url}" alt="${camera.name}" loading="lazy" />
              </div>
              <div class="toolbar ${showToolbarClass} ${screenSizeClass}">
                <a target="_blank" class="snapshot" href="${camera.url}" download="${camera.name.replace(' ', '_') + "_" + new Date().toISOString() + ".jpg"}"></a>
                <a class="record" @click="${(clickEvent) => this._recordSequence(clickEvent)}"></a>
              </div>
            `;
          })}
        </div>
        <div class="mainImage">
          ${this.renderMain()}
        </div>
      </div>
    `;
  }

  renderMain() {
    if (this.liveStream) {
      const cameraObj = this.hass.states[this.selectedCamera.entity];
      if (!cameraObj) {
        return html``;
      }

      return html`
        <div class="fullscreen-container">
          <ha-camera-stream
            .hass=${this.hass}
            .stateObj="${cameraObj}"
            style="width: 100%; height: 100%; object-fit: cover;"
          ></ha-camera-stream>
          <button class="fullscreen-btn" @click="${this._toggleFullscreen}">Fullscreen</button>
        </div>
      `;
    }

    return html`<img src="${this.selectedCamera.stream_url}" alt="${this.selectedCamera.name}" />`;
  }

  _toggleFullscreen() {
    const mainImage = this.shadowRoot.querySelector(".mainImage");
    if (mainImage.requestFullscreen) {
      mainImage.requestFullscreen();
    } else if (mainImage.webkitRequestFullscreen) {
      mainImage.webkitRequestFullscreen();
    } else if (mainImage.msRequestFullscreen) {
      mainImage.msRequestFullscreen();
    }
  }

  static get properties() {
    return {
      hass: { type: Object },
      cameras: { type: Array },
      selectedCamera: { type: Object },
      focusOnMotion: { type: Boolean },
      thumbInterval: { type: Number },
      thumbPosition: { type: String },
      updateInterval: { type: Number },
      recordingDuration: { type: Number },
      showCaptureButtons: { type: Boolean },
      liveStream: { type: Boolean },
    };
  }

  get hass() {
    return this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    this.updateCameras();
  }

  connectedCallback() {
    super.connectedCallback();
    this.thumbUpdater = setInterval(() => this.updateCameras(), this.thumbInterval);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.thumbUpdater);
  }

  setConfig(config) {
    if (!config.cameras) {
      throw new Error("You need to define cameras");
    }

    this.focusOnMotion = config.focus_motion !== false;
    this.thumbInterval = (config.thumb_interval || 10.0) * 1000;
    this.updateInterval = config.update_interval || 1.0;
    this.recordingDuration = config.recording_duration || 10.0;
    this.showCaptureButtons = config.show_capture_buttons !== false;
    this.liveStream = config.camera_view === "live";
    this.thumbPosition = config.thumb_position || "left";

    this.isMobileApp = navigator.userAgent.indexOf("HomeAssistant") > -1;

    const now = Date.now();
    this.cameras = config.cameras.map((camera) => {
      const { states = {} } = this.hass || {};
      const entity = states[camera.entity];
      const attributes = entity?.attributes;
      const motionEntities = Array.isArray(camera.motion_entity)
        ? camera.motion_entity
        : [camera.motion_entity].filter((entityId) => !!entityId);

      return {
        access_token: attributes?.access_token,
        entity: camera.entity,
        motion_entities: motionEntities,
        name: attributes?.friendly_name,
        has_motion: motionEntities.some((entityId) => states[entityId]?.state === "on"),
        last_motion: now,
        last_update: now,
        stream_url: "",
        url: attributes?.entity_picture,
      };
    });
    this.updateCameras = this.throttle(() => this._updateCameras(), this.thumbInterval);
    this._updateSelectedCamera();
  }

  _updateCameras() {
    const now = Date.now();
    const { states = {} } = this.hass || {};
    const activatedCameras = [];

    for (const camera of this.cameras) {
      const hadMotion = camera.has_motion === true;
      const { motion_entities } = camera;
      camera.has_motion = motion_entities.some((entityId) => states[entityId]?.state === "on");
      if (camera.has_motion) {
        camera.last_motion = now;
      }

      const motionActivated = !hadMotion && camera.has_motion;
      if (motionActivated) {
        activatedCameras.push(camera);
      }

      if (motionActivated || now - camera.last_update > this.thumbInterval) {
        camera.last_update = now;
      }

      const attributes = states[camera.entity]?.attributes || {};
      camera.access_token = attributes.access_token;
      camera.name = attributes.friendly_name;
      camera.url = `${attributes.entity_picture}&last_update=${camera.last_update}&resolution=high`;
      camera.stream_url = `/api/camera_proxy_stream/${camera.entity}?token=${camera.access_token}&interval=${this.updateInterval}`;
    }

    if (this.focusOnMotion && activatedCameras.length > 0) {
      this._updateSelectedCamera(
        activatedCameras.find((c) => c === this.selectedCamera) || activatedCameras[0]
      );
    }

    this.cameras.sort(this._cameraSortComparer);
    this.cameras = [...this.cameras];
  }

  _updateSelectedCamera(camera) {
    if (!camera || !camera.access_token) {
      let availableCameras = this.cameras.filter((c) => c.access_token && c.has_motion);
      availableCameras.sort(this._cameraSortComparer);
      camera = availableCameras[0] || this.cameras[0];
    }

    if (this.selectedCamera !== camera) {
      this.selectedCamera = camera;
    }
  }

  _cameraSortComparer(cameraA, cameraB) {
    if (cameraA.has_motion < cameraB.has_motion) {
      return 1;
    }

    if (cameraA.has_motion === cameraB.has_motion) {
      if (cameraA.last_update < cameraB.last_update) {
        return 0;
      }

      return cameraA.last_update === cameraB.last_update ? 0 : -1;
    }
  }

  _recordSequence(clickEvent) {
    let currentThumbSnapshotBtn = clickEvent.srcElement.previousElementSibling;
    let cameraThumbContainer = clickEvent.srcElement.parentElement.previousElementSibling;

    let totalSnapshots = this.recordingDuration / (this.thumbInterval / 1000);
    let snapshotCount = 1;

    currentThumbSnapshotBtn.click();
    cameraThumbContainer.classList.add("recording");

    let snapshotInterval = setInterval(function () {
      currentThumbSnapshotBtn.click();
      snapshotCount++;

      if (snapshotCount > totalSnapshots) {
        cameraThumbContainer.classList.remove("recording");
        clearInterval(snapshotInterval);
      }
    }, this.thumbInterval);
  }

  static get styles() {
    return css`
      .container {
        height: 100%;
        width: 100%;
        display: flex;
        align-items: stretch;
        position: absolute;
      }

      .thumbs {
        flex: 1;
        overflow-y: auto;
        position: relative;
        text-align: center;
        max-height: 100%;
      }

      .mainImage {
        flex: 4;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .mainImage img {
        display: inline-block;
        max-width: 100%;
        max-height: 100%;
        object-fit: cover;
      }

      .thumb {
        width: calc(100% - 9px);
        padding: 2px 4px;
        position: relative;
      }

      .thumb.motion > img {
        border-color: var(--accent-color);
      }

      .thumb.selected img {
        border-color: var(--accent-color);
        box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
      }

      .fullscreen-container {
        position: relative;
      }

      .fullscreen-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 1000;
        background-color: rgba(0, 0, 0, 0.5);
        color: white;
        border: none;
        padding: 10px;
        cursor: pointer;
        border-radius: 4px;
      }

      .toolbar {
        overflow: hidden;
        position: relative;
        left: 50%;
        margin-left: -65px;
        width: 132px;
        height: 62px;
        bottom: 78px;
        margin-bottom: -62px;
      }

      .toolbar.smallScreen {
        bottom: 30px;
        width: auto;
        left: auto;
        margin: 0px 0px -30px;
      }

      .toolbar.tinyScreen {
        bottom: 0;
        height: 150px;
        width: auto;
        margin: 6px 0;
        left: 0;
      }

      .snapshot,
      .record {
        display: inline-block;
        background-repeat: no-repeat;
        background-size: 60% 60%;
        background-position: 50% 50%;
        opacity: 0.8;
        background-color: rgb(51, 51, 51);
        border-radius: 60px;
        cursor: pointer;
        border: 1px solid var(--primary-color);
      }

      @media (max-width: 768px) {
        .mainImage {
          flex: 2;
        }

        .toolbar {
          width: auto;
          height: auto;
          position: static;
          display: flex;
          justify-content: center;
        }

        .snapshot,
        .record {
          width: 40px;
          height: 40px;
        }
      }

      .loading {
        text-align: center;
        font-size: 1.2rem;
        margin-top: 3rem;
      }
    `;
  }
  throttle(callback, delay) {
    let isThrottled = false,
      args,
      context;
    function wrapper() {
      if (isThrottled) {
        args = arguments;
        context = this;
        return;
      }
      isThrottled = true;
      callback.apply(this, arguments);
      setTimeout(() => {
        isThrottled = false;
        if (args) {
          wrapper.apply(context, args);
          args = context = null;
        }
      }, delay);
    }
    return wrapper;
  }
}
customElements.define("surveillance-card", SurveillanceCard);
