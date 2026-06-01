import '@soundworks/helpers/polyfills.js';
import { Client } from '@soundworks/core/client.js';
import { loadConfig, launcher } from '@soundworks/helpers/browser.js';
import { html, render, nothing } from 'lit';

import ComoClient from '@ircam/como/ComoClient.js';

import '@ircam/sc-components/sc-icon.js';
import '@ircam/sc-components/sc-midi.js';
import '@ircam/sc-components/sc-button.js';
import '@ircam/sc-components/sc-text.js';
import '@ircam/sc-components/sc-toggle.js';


const APP_PLAYER_ID = 'gesture-player';
const APP_SCRIPT_NAME = 'gesture-sound.js';

async function main($container) {
  const config = loadConfig();
  const client = new Client(config);

  launcher.register(client, {
    initScreensContainer: $container,
    reloadOnVisibilityChange: false,
  });

  const como = new ComoClient(client);
  await como.start();

  const controller = await como.stateManager.create('controller', {
    showEditScriptPanel: false,
  });

  let scriptState = null;
  let attachedScriptStateId = null;
  let unsubscribeScriptState = null;


  async function attachToGestureSoundScript() {
    const playerState = como.playerManager.players.find(player => {
      return player.get('id') === APP_PLAYER_ID
        || player.get('scriptName') === APP_SCRIPT_NAME;
    });

    if (!playerState) {
      detachScriptState();
      renderApp();
      return;
    }

    const scriptSharedStateId = playerState.get('scriptSharedStateId');

    if (!scriptSharedStateId) {
      detachScriptState();
      renderApp();
      return;
    }

    if (attachedScriptStateId === scriptSharedStateId) {
      return;
    }

    detachScriptState();

    scriptState = await como.playerManager.getScriptSharedState(playerState.get('id'));
    attachedScriptStateId = scriptSharedStateId;
    unsubscribeScriptState = scriptState.onUpdate(renderApp, true);

    renderApp();
  }

  function detachScriptState() {
    if (unsubscribeScriptState) {
      unsubscribeScriptState();
      unsubscribeScriptState = null;
    }

    scriptState = null;
    attachedScriptStateId = null;
  }

  como.playerManager.players.onChange(() => {
    attachToGestureSoundScript();
  });

  como.playerManager.players.onUpdate(() => {
    attachToGestureSoundScript();
  });

  controller.onUpdate(renderApp, true);

  await attachToGestureSoundScript();

  function setSelectedLabel(label) {
    scriptState?.set({ selectedLabel: label || null });
  }

  function previewSound(label) {
    if (!label) return;
    scriptState?.set({ previewLabel: label });
  }

  function toggleRecord() {
    if (!scriptState) return;
    scriptState.set({ record: !scriptState.get('record') });
  }

  function setMode(mode) {
    scriptState?.set({ mode, scores: {}, recognizedLabel: null });
  }

  function setThreshold(value) {
    scriptState?.set({ threshold: value });
  }

  function setCooldown(value) {
    scriptState?.set({ cooldown: value });
  }

  function deleteExample(uuid) {
    scriptState?.set({ deleteExampleUuid: uuid });
  }

  function clearLabel(label) {
    scriptState?.set({ clearLabel: label });
  }

  function clearAllExamples() {
    scriptState?.set({ clearAllRequest: Date.now() });
  }

  function renderCustomApp() {
    if (!scriptState) {
      return html`
        <section class="app-panel">
          <h2>Gesture Sound App</h2>
          <p class="warning">En attente du player <code>${APP_PLAYER_ID}</code>.</p>
          <p>
            Lance le client device. Il doit créer une source Comote et charger
            automatiquement <code>${APP_SCRIPT_NAME}</code>.
          </p>
        </section>
      `;
    }

    const labels = scriptState.get('labels') || [];
    const selectedLabel = scriptState.get('selectedLabel');
    const record = scriptState.get('record');
    const training = scriptState.get('training');
    const mode = scriptState.get('mode');
    const threshold = scriptState.get('threshold');
    const cooldown = scriptState.get('cooldown');
    const status = scriptState.get('status');
    const lastMessage = scriptState.get('lastMessage');
    const lastError = scriptState.get('lastError');
    const recognizedLabel = scriptState.get('recognizedLabel');
    const scores = scriptState.get('scores') || {};
    const examples = scriptState.get('examples') || {};

    return html`
      <section class="app-panel">
        <h2>Gesture Sound App</h2>

        <p class="subtitle">
          Choisis un son, enregistre un geste, puis passe en mode jeu pour déclencher le bon son avec le geste reconnu.
        </p>

        <div class="mode-row">
          <button class=${mode === 'learn' ? 'active' : ''} @click=${() => setMode('learn')} ?disabled=${record || training}>
            Mode apprentissage
          </button>

          <button class=${mode === 'play' ? 'active' : ''} @click=${() => setMode('play')} ?disabled=${record || training}>
            Mode jeu
          </button>
        </div>

        <div class="status-box">
          <p><strong>État :</strong> ${status}</p>
          <p><strong>Message :</strong> ${lastMessage || '—'}</p>
          ${lastError ? html`<p class="error"><strong>Erreur :</strong> ${lastError}</p>` : nothing}
          <p><strong>Dernier son reconnu :</strong> ${recognizedLabel || 'aucun'}</p>
        </div>

        <section class="sub-panel">
          <h3>1. Sons disponibles</h3>

          ${labels.length === 0 ? html`
            <p>Aucun son trouvé dans la soundbank.</p>
          ` : html`
            <div class="sound-list">
              ${labels.map(label => html`
                <div class="sound-row ${selectedLabel === label ? 'selected' : ''}">
                  <span>${label}</span>
                  <button @click=${() => previewSound(label)}>Lire</button>
                  <button @click=${() => setSelectedLabel(label)}>
                    ${selectedLabel === label ? 'Sélectionné' : 'Sélectionner'}
                  </button>
                </div>
              `)}
            </div>
          `}
        </section>

        <section class="sub-panel">
          <h3>2. Enregistrer un geste</h3>

          <p>Son sélectionné : <strong>${selectedLabel || 'aucun'}</strong></p>

          <button class=${record ? 'recording' : ''} @click=${toggleRecord} ?disabled=${!selectedLabel || training || mode !== 'learn'}>
            ${record ? 'Stop record + entraîner' : 'Start record'}
          </button>

          ${mode !== 'learn' ? html`<p class="hint">Repasse en mode apprentissage pour enregistrer de nouveaux gestes.</p>` : nothing}
        </section>

        <section class="sub-panel">
          <h3>3. Gestes enregistrés</h3>

          ${Object.keys(examples).length === 0 ? html`
            <p>Aucun geste enregistré pour le moment.</p>
          ` : html`
            <button class="danger" @click=${clearAllExamples} ?disabled=${training || record}>
              Supprimer tous les gestes
            </button>

            <div class="examples-list">
              ${Object.entries(examples).map(([label, infos]) => html`
                <div class="example-group">
                  <div class="example-group-header">
                    <strong>${label}</strong>
                    <span>${infos.numExamples} exemple(s)</span>
                    <button class="danger" @click=${() => clearLabel(label)} ?disabled=${training || record}>
                      Supprimer ce son
                    </button>
                  </div>

                  ${(infos.uuids || []).map((uuid, index) => html`
                    <div class="example-row">
                      <span>Geste ${index + 1}</span>
                      <code>${uuid.slice(0, 8)}…</code>
                      <button class="danger" @click=${() => deleteExample(uuid)} ?disabled=${training || record}>
                        Supprimer
                      </button>
                    </div>
                  `)}
                </div>
              `)}
            </div>
          `}
        </section>

        <section class="sub-panel">
          <h3>4. Paramètres de jeu</h3>

          <label>
            Seuil de reconnaissance : ${threshold.toFixed(2)}
            <input type="range" min="0" max="1" step="0.01" .value=${String(threshold)} @input=${e => setThreshold(parseFloat(e.target.value))} />
          </label>

          <label>
            Cooldown : ${cooldown} ms
            <input type="range" min="100" max="3000" step="100" .value=${String(cooldown)} @input=${e => setCooldown(parseInt(e.target.value))} />
          </label>
        </section>

        <section class="sub-panel">
          <h3>5. Scores XMM</h3>

          ${Object.keys(scores).length === 0 ? html`
            <p>Les scores apparaîtront en mode jeu quand le modèle reconnaîtra les gestes.</p>
          ` : html`
            <div class="scores-list">
              ${Object.entries(scores).map(([label, score]) => html`
                <div class="score-row">
                  <span>${label}</span>
                  <progress max="1" .value=${score}></progress>
                  <span>${score.toFixed(3)}</span>
                </div>
              `)}
            </div>
          `}
        </section>
      </section>
    `;
  }

  function renderApp() {
    render(html`
      <style>
        .controller-layout { box-sizing: border-box; padding: 16px; font-family: system-ui, sans-serif; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
        .como-tools { border: 1px solid #333; border-radius: 8px; padding: 12px; margin-bottom: 28px; opacity: 0.9; }
        .app-panel { border: 2px solid #555; border-radius: 12px; padding: 20px; max-width: 1000px; }
        .subtitle, .hint { opacity: 0.75; }
        .warning { color: #ffb000; font-weight: bold; }
        .error { color: #ff6868; }
        .mode-row { display: flex; gap: 12px; margin: 16px 0; }
        button { cursor: pointer; border: 1px solid #555; border-radius: 6px; padding: 8px 12px; background: transparent; color: inherit; }
        button:hover { background: rgba(255, 255, 255, 0.08); }
        button.active { background: rgba(255, 255, 255, 0.18); font-weight: bold; }
        button.recording { background: rgba(255, 70, 70, 0.35); border-color: #ff6868; }
        button.danger { border-color: #b44; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        .status-box { border-radius: 8px; padding: 12px; margin: 16px 0; background: rgba(255, 255, 255, 0.05); }
        .status-box p { margin: 6px 0; }
        .sub-panel { border-top: 1px solid #333; margin-top: 20px; padding-top: 16px; }
        .sound-list, .examples-list, .scores-list { display: flex; flex-direction: column; gap: 8px; }
        .sound-row, .example-row, .example-group-header, .score-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.04); }
        .sound-row.selected { outline: 1px solid #aaa; }
        .example-group { border: 1px solid #333; border-radius: 8px; padding: 8px; }
        .score-row { grid-template-columns: 220px 1fr 70px; }
        progress { width: 100%; }
        label { display: flex; flex-direction: column; gap: 8px; max-width: 420px; margin: 12px 0; }
      </style>

      <div class="controller-layout">
        <header>
          <h1>${client.config.app.name} | ${client.role}</h1>

          <div style="display: flex; align-items: center; gap: 8px;">
            <sc-midi></sc-midi>
            <como-project-manager .como=${como}></como-project-manager>
            <sc-icon
              type="prompt"
              ?active=${controller.get('showEditScriptPanel')}
              @input=${() => controller.set('showEditScriptPanel', !controller.get('showEditScriptPanel'))}
            ></sc-icon>
            <sw-audit .client="${client}"></sw-audit>
          </div>
        </header>

        <section class="como-tools">
          <h2>Interface CoMo</h2>
          <como-session-manager expanded .como=${como}></como-session-manager>
          <como-source-manager .como=${como}></como-source-manager>
          <como-player-manager .como=${como} expanded></como-player-manager>

          ${controller.get('showEditScriptPanel')
      ? html`<como-script-manager .como=${como}></como-script-manager>`
      : nothing
    }
        </section>

        ${renderCustomApp()}
      </div>
    `, $container);
  }
}

launcher.execute(main, {
  numClients: parseInt(new URLSearchParams(window.location.search).get('emulate') || '') || 1,
  width: '50%',
});
