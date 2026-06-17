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
import '@ircam/sc-components/sc-slider.js';
import '@ircam/sc-components/sc-status.js';
import '@ircam/sc-components/sc-dragndrop.js';



const APP_PLAYER_ID = 'gesture-player';
const APP_SCRIPT_NAME = 'gesture-sound.js';

const AUDIO_FILE_EXTENSION =
  /\.(wav|mp3|ogg|m4a|aac|flac|aif|aiff)$/i;


function isAudioFile(file) {
  if (!(file instanceof File)) {
    return false;
  }

  return (
    file.type.startsWith('audio/')
    || AUDIO_FILE_EXTENSION.test(
      file.name,
    )
  );
}


async function main($container) {
  const config = loadConfig();
  const client = new Client(config);

  launcher.register(client, {
    initScreensContainer: $container,
    reloadOnVisibilityChange: false,
  });

  const como = new ComoClient(client);
  await como.start();

  const controller = await como.stateManager.create('controller', { showEditScriptPanel: false });
  const userSoundbankFilesystem = await client.pluginManager.get('soundbankManager:filesystem');


  let scriptState = null;
  let attachedScriptStateId = null;
  let unsubscribeScriptState = null;
  let playersExpanded = false;
  let gesturePlayerState = null;


  userSoundbankFilesystem.onUpdate(
    () => {
      void syncUserSoundbankToScript()
        .catch(error => {
          console.error(
            'Erreur de synchronisation de la soundbank :',
            error,
          );
        });

      renderApp();
    },
    true,
  );


  const sourceUnsubscribers = new Map();


  // ----------- Source subscribe --------------
  function subscribeToSources() {

    for (const unsubscribe of sourceUnsubscribers.values()) {
      unsubscribe();
    }

    sourceUnsubscribers.clear();

    // Subscribe to each source
    for (const source of como.sourceManager.sources) {
      const sourceId = source.get('id');

      const unsubscribe = source.onUpdate(() => {
        renderApp();
      });

      sourceUnsubscribers.set(sourceId, unsubscribe);
    }

    renderApp();
  }

  // A source has just been added or removed
  como.sourceManager.sources.onChange(() => {
    subscribeToSources();
  });

  subscribeToSources();




  async function attachToGestureSoundScript() {
    const nextPlayerState = como.playerManager.players.find(player => {
      return player.get('id') === APP_PLAYER_ID
        || player.get('scriptName') === APP_SCRIPT_NAME;
    });

    if (!nextPlayerState) {
      gesturePlayerState = null;
      detachScriptState();
      renderApp();
      return;
    }

    gesturePlayerState = nextPlayerState;
    const scriptSharedStateId = gesturePlayerState.get('scriptSharedStateId');

    if (!scriptSharedStateId) {
      detachScriptState();
      renderApp();
      return;
    }

    if (attachedScriptStateId === scriptSharedStateId) {
      return;
    }

    detachScriptState();

    scriptState = await como.playerManager.getScriptSharedState(gesturePlayerState.get('id'));
    attachedScriptStateId = scriptSharedStateId;
    unsubscribeScriptState = scriptState.onUpdate(renderApp, true);

    renderApp();

    await syncUserSoundbankToScript();

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
    renderApp();
  });

  como.playerManager.players.onUpdate(() => {
    attachToGestureSoundScript();
    renderApp();
  });


  controller.onUpdate(renderApp, true);

  await attachToGestureSoundScript();


  function setSelectedLabel(label) {
    scriptState?.set({
      selectedLabel: label || null,
      previewLabel: null,
    });
  }


  function setGestureName(value) {
    scriptState?.set({
      gestureName: value,
    });
  }


  // Listen preview sound
  function togglePreviewSound(label) {
    if (!scriptState || !label) {
      return;
    }

    const currentPreviewLabel = scriptState.get('previewLabel');

    if (currentPreviewLabel === label) {
      // The sound is already playing: we stop it
      scriptState.set({
        previewLabel: null,
      });
    } else {
      // We play this sound
      scriptState.set({
        previewLabel: label,
      });
    }
  }


  function toggleRecord() {
    if (!scriptState) {
      return;
    }
    scriptState.set({ record: !scriptState.get('record') });
  }


  function setMode(mode) {
    scriptState?.set({ mode, recognizedLabel: null });
  }


  function deleteExample(uuid) {
    scriptState?.set({ deleteExampleUuid: uuid });
  }


  function clearAllExamples() {
    scriptState?.set({ clearAllRequest: Date.now() });
  }


  function togglePlayersExpanded() {
    playersExpanded = !playersExpanded;
    renderApp();
  }


  function toggleWaitingPreview() {
    if (!scriptState) {
      return;
    }

    scriptState.set({
      waitingPreview:
        !scriptState.get('waitingPreview'),
    });
  }

  function validateWaitingGesture() {
    scriptState?.set({
      validateWaitingRequest: Date.now(),
    });
  }

  function cancelWaitingGesture() {
    scriptState?.set({
      cancelWaitingRequest: Date.now(),
    });
  }


  function getExistingAudioFilenames() {
    const urlMap = userSoundbankFilesystem.getTreeAsUrlMap(
      undefined,
      true,
    );

    return new Set(
      Object.keys(urlMap).map(pathname => {
        return pathname.split('/').pop();
      }),
    );
  }


  function createUniqueAudioFilename(originalFilename) {
    const existingFilenames =
      getExistingAudioFilenames();

    const labels =
      scriptState?.get('labels') || [];

    for (const label of labels) {
      existingFilenames.add(label);
    }

    if (!existingFilenames.has(originalFilename)) {
      return originalFilename;
    }

    const dotIndex =
      originalFilename.lastIndexOf('.');

    const hasExtension = dotIndex > 0;

    const basename = hasExtension
      ? originalFilename.slice(0, dotIndex)
      : originalFilename;

    const extension = hasExtension
      ? originalFilename.slice(dotIndex)
      : '';

    let index = 2;
    let candidate =
      `${basename}-${index}${extension}`;

    while (existingFilenames.has(candidate)) {
      index += 1;
      candidate =
        `${basename}-${index}${extension}`;
    }

    return candidate;
  }


  async function syncUserSoundbankToScript() {
    if (
      !scriptState
      || !userSoundbankFilesystem
    ) {
      return;
    }

    const urlMap = userSoundbankFilesystem.getTreeAsUrlMap(undefined, true,);

    const userSoundFiles =
      Object.entries(urlMap)
        .filter(([pathname]) => {
          return AUDIO_FILE_EXTENSION.test(
            pathname,
          );
        })
        .map(([pathname, url]) => {
          const label = pathname
            .split('/')
            .pop();

          /*
           * Le player tourne éventuellement
           * sur la Raspberry Pi.
           *
           * Il lui faut donc une URL absolue,
           * et non une URL relative au navigateur.
           */
          const absoluteUrl = new URL(url, window.location.origin).href;
          return {
            label,
            url: absoluteUrl,
          };

        });

    await scriptState.set({
      userSoundFiles,

      /*
       * Garantit que le player reçoit
       * une nouvelle demande, même si la liste
       * de fichiers semble identique.
       */
      reloadUserSoundsRequest:
        Date.now(),
    });
  }





  async function handleAudioDrop(event) {
    if (!scriptState) {
      return;
    }

    const record =
      scriptState.get('record');

    const training =
      scriptState.get('training');

    const waitingGesture =
      scriptState.get('waitingGesture');

    if (
      record
      || training
      || waitingGesture
    ) {
      await scriptState.set({
        lastError:
          'Terminez l’enregistrement en cours avant d’importer un son.',
      });

      return;
    }

    const droppedFiles =
      Object.values(
        event.detail?.value || {},
      );

    const audioFiles =
      droppedFiles.filter(isAudioFile);

    if (audioFiles.length === 0) {
      await scriptState.set({
        lastError:
          'Aucun fichier audio valide n’a été déposé.',
      });

      return;
    }

    try {
      await scriptState.set({
        status: 'uploading-sounds',
        lastMessage:
          `Import de ${audioFiles.length} son(s)...`,
        lastError: '',
      });

      const importedFilenames = [];

      for (const file of audioFiles) {
        const filename =
          createUniqueAudioFilename(
            file.name,
          );

        await userSoundbankFilesystem.writeFile(
          filename,
          file,
        );

        importedFilenames.push(filename);
      }


      await syncUserSoundbankToScript();


      await scriptState.set({
        status: 'ready',
        lastMessage:
          `${importedFilenames.length} son(s) importé(s) : `
          + importedFilenames.join(', '),
        lastError: '',
      });
    } catch (error) {
      console.error(
        'Erreur d’import audio :',
        error,
      );

      await scriptState.set({
        status: 'error',
        lastError:
          `Impossible d’importer les sons : ${
            error?.message || String(error)
          }`,
      });
    }
  }






  function renderCustomApp() {
    if (!scriptState) {
      return html`
        <section class="app-panel">
          <h2>CoMo.education App Prototype</h2>
          <p class="warning">En attente du player <code>${APP_PLAYER_ID}</code>.</p>
          <p>
            Lance le client device.
          </p>
        </section>
      `;
    }

    const labels = scriptState.get('labels') || [];
    const selectedLabel = scriptState.get('selectedLabel');
    const record = scriptState.get('record');
    const training = scriptState.get('training');
    const mode = scriptState.get('mode');
    const lastMessage = scriptState.get('lastMessage');
    const lastError = scriptState.get('lastError');
    const examples = scriptState.get('examples') || {};
    const sources = Array.from(como.sourceManager.sources);
    const playerCount = Array.from(como.playerManager.players).length;
    const previewLabel = scriptState.get('previewLabel');
    const gestureName = scriptState.get('gestureName') || '';

    const waitingGesture = scriptState.get('waitingGesture');
    const waitingPreview = scriptState.get('waitingPreview');


    const gestureRows = Object.entries(examples).flatMap(
      ([modelLabel, infos]) => {
        const uuids = Array.isArray(infos?.uuids)
          ? infos.uuids
          : [];

        return uuids.map(uuid => ({
          uuid,
          modelLabel,
          gestureName: infos?.gestureName || modelLabel,
          soundLabel: infos?.soundLabel || modelLabel,
        }));
      },
    );



    return html`

      <!---- Title ---->
      <section class="app-panel">
        <h1 class = "center">
          CoMo.education App Prototype
        </h1>
        <h3 class="center">
          Choisissez un son, enregistrez un geste, puis passez en mode jouer pour déclencher le bon son avec le geste reconnu.
        </h3>


        <button
          class="players-toggle ${playersExpanded ? 'expanded' : ''}"
          @click=${togglePlayersExpanded}>
          <strong>
            Infos Sources
          </strong>

          <span class="toggle-icon">
            ${playersExpanded ? '−' : '+'}
          </span>
        </button>


        ${playersExpanded ? html`
          <!----- Source ----->
          <section class="source-panel">
            <div class="player-status">
              <strong>
                Players connectés :
              </strong>

              <span>
                ${playerCount}
              </span>
            </div>

            ${sources.length === 0 ? html`
              ` : sources.map(source => {

              return html`
                <div class="source-status ${source.get('active') ? 'connected' : 'disconnected'}">
                  <sc-status
                    ?active=${source.get('active')}>
                  </sc-status>

                  <span class="source-state">
                    ${source.get('active') ? 'Source connectée' : 'Source déconnectée'}
                  </span>

                  <strong class="source-name">
                    id: ${source.get('id')}
                  </strong>

                  ${source.get('type') ? html`
                    <span class="source-type">
                      type: ${source.get('type')}
                    </span>
                    ` : nothing
                  }
                </div>
              `;
            })}
          </section>
          ` : nothing}



        <!---------- Modes Button ------------->
        <div class="mode-row">

          <!---- Creation Mode Button ---->
          <button
            class="mode-button learn-button ${mode=== 'learn' ? 'active-mode' : ''}"
            @click=${() => setMode('learn')}
            ?disabled=${record || training}
          >
            Création
          </button>

          <!----- Play Mode Button ----->
          <button
            class="mode-button play-button ${mode === 'play' ? 'active-mode' : ''}"
            @click=${() => setMode('play')}
            ?disabled=${record || training || waitingGesture}
          >
            Jouer
          </button>
        </div>


        <!---------- Master Parameters --------->
        ${gesturePlayerState ? html`
          <div class="master-controls">

            <!------ Volume Slider ------->
            <div class="volume-control">
              <strong class="volume-control">
                Volume
              </strong>

              <sc-slider
                number-box
                min=${gesturePlayerState.getDescription('volume').min}
                max=${gesturePlayerState.getDescription('volume').max}
                value=${gesturePlayerState.get('volume')}
                @input=${e => gesturePlayerState.set('volume', e.detail.value)}
              ></sc-slider>
            </div>


            <!------- Mute ------->
            <div class="mute-control">
              <button
                class="mute-button ${gesturePlayerState.get('mute') ? 'active-mute' : ''}"
                @click=${() => gesturePlayerState.set('mute', !gesturePlayerState.get('mute'))}
              >
                ${gesturePlayerState.get('mute') ? 'Unmute' : 'Mute'}
              </button>
            </div>
          </div>
        ` : nothing}



        <!---------- Console ------------>
        <div class="message-box">
          <p>
            <strong>
            Message :
            </strong> ${lastMessage || '—'}
          </p> ${lastError ? html`


          <p class="error">
            <strong>
              Erreur :
            </strong> ${lastError}
          </p>` : nothing}
        </div>



        <!-------------  Left Column ------------->
        <div class="app-grid">
          <div class="scroller">
            <section class="sub-panel left-column">


              <sc-dragndrop
                format="raw"
                class="sound-dragndrop ${record || training || waitingGesture ? 'disabled' : ''}"
                @change=${handleAudioDrop}
              >

                <div class="sound-drop-content">
                  <strong>
                    Importer des sons
                  </strong>

                  <span>
                    Glissez-déposez ici vos fichiers
                    WAV, MP3, OGG, M4A ou FLAC
                  </span>
                </div>
              </sc-dragndrop>


              <h2 class="center">
                Sons disponibles
              </h2>


              ${labels.length === 0 ? html`
                <p>
                  Aucun son trouvé dans la soundbank.
                </p>
              ` : html`
                <div
                  class="sound-list">
                  ${labels.map(label => {
                    const isPreviewing = previewLabel === label;

                    return html `
                      <div
                        class="sound-row ${selectedLabel === label ? 'selected' : ''}">
                        <span>
                          ${label}
                        </span>

                        <!---- Listen Sound Button ----->
                        <button
                          class="listen-button ${isPreviewing ? 'active-mode' : ''}"
                          @click=${() => togglePreviewSound(label)}
                        >
                          ${isPreviewing ? 'Arrêter' : 'Écouter'}
                        </button>


                        <!--  Select Sound Button -->
                        <button
                          class="select-button ${selectedLabel === label ? 'active-mode' : ''}"
                          @click=${() => setSelectedLabel(label)}>
                          ${selectedLabel === label ? 'Sélectionné' : 'Sélectionner'}
                        </button>
                      </div>
                    `;
                  })}
                </div>
              `}
            </section>
          </div>


          <!----------  Right Column ------------>
          <div class="right-column">
            <section class="sub-panel">

              <!----  Record Gesture Part  -->
              <h2 class="center">
                Enregistrer un nouveau geste
              </h2>

              <br>

              <h3>
                Son sélectionné :
                <strong>
                  ${selectedLabel || 'aucun'}
                </strong>
              </h3>


              <!-------  Gesture Name  ----->
              <div class="gesture-name-control">
                <label for="gesture-name">
                  Nom du geste :
                </label>

                <input
                  id="gesture-name"
                  class="gesture-name-input"
                  type="text"
                  placeholder="Donnez un nom au geste..."
                  .value=${gestureName}
                  @input=${event => {
                    setGestureName(event.target.value);
                  }}
                  ?disabled=${record || training || mode !== 'learn'}
                >
              </div>




              <!----  Record Gesture Button -->
              <button
                class=${record ? 'recording' : 'record'}
                @click=${toggleRecord}
                ?disabled=${!selectedLabel || !gestureName.trim () ||training || waitingGesture || mode !== 'learn'}
              >
                ${record ? 'Arreter' : 'Enregistrer'}
              </button>

              ${mode !== 'learn' ? html`
                <p
                  class="hint">
                  Repassez en mode apprentissage pour enregistrer de nouveaux gestes.
                </p>
              ` : nothing}



              <button
                class="preview-gesture-button ${waitingPreview ? 'active-preview' : ''}"
                @click=${toggleWaitingPreview}
                ?disabled=${!waitingGesture || training}
              >
                ${waitingPreview
                  ? 'Arrêter le test'
                  : 'Tester le geste'}
              </button>

              <button
                class="validate-gesture-button"
                @click=${validateWaitingGesture}
                ?disabled=${!waitingGesture || training}
              >
                Valider
              </button>

              <button
                class="delete-waiting-gesture"
                @click=${cancelWaitingGesture}
                ?disabled=${!waitingGesture || training}
              >
                Annuler
              </button>
            </section>


            <!-----------  Recorded Examples ---------->
            <section class="sub-panel">
              <h2
                class="center">
                Gestes enregistrés
              </h2>
              <br>

              ${gestureRows.length === 0 ? html`
                <p>Aucun geste enregistré pour le moment.</p>
               ` : html`

                <!----  Delete All Examples Button -->
                <div class="center">
                  <button
                    class="delete-all"
                    @click=${clearAllExamples}
                    ?disabled=${training || record}
                  >
                    Supprimer tous les gestes
                  </button>
                </div>
                <br>


                <!---- Examples List  -->
                <div class="examples-list">
                  ${gestureRows.map(({ uuid, gestureName, soundLabel }, index) => html`
                    <div class="example-row">
                        <span>
                            Geste n°${index + 1}: ${gestureName} | Son : ${soundLabel}
                        </span>

                      <!-------- Delete Example Button ------>
                        <button
                            class="delete-examples"
                            @click=${() => deleteExample(uuid)}
                            ?disabled=${training || record}
                        >
                         Supprimer ce geste
                        </button>
                    </div>
                 `)}
                </div>
              `}
            </section>
          </div>
        </div>
      </section>
    `;
  }


  // ----------------- Styles -------------------
  function renderApp() {
    render(html`
      <style>


        /* ----------- Colors ---------- */
        :root {

          --gray: rgba(255, 255, 255, 0.1);
          --gray-bg: rgba(255, 255, 255, 0.06);


          --red: rgba(255, 104, 104, 1);
          --red-bg: rgba(255, 51, 0, 0.8);
          --red-border: rgba(255, 51, 0, 0.8);

          --orange: rgba(255, 176, 0, 1);
          --orange-bg: rgba(255, 140, 26, 0.8);

          --green-bg: rgba(51, 204, 51, 0.8);
          --green-border: rgba(51, 204, 51, 1);

          --white-border: rgba(255, 255, 255, 1);

          --cyan-bg: rgba(51, 204, 204, 0.8);
          --blue: rgba(0, 153, 255, 1);
        }


        /* ----------- App Shape  ---------- */
        .app-panel {
          border: 1px solid var(--gray-bg);
          justify-content: center;
          align-items: center;
          border-radius: 12px;
          padding: 20px;
          max-width: 1900px;
        }

        header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-bottom: 16px;
        }


        .center {
          text-align: center;
        }


        .app-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(400px, 0.8fr);
          gap: 24px;
          align-items: start;
          margin-top: 20px;
        }

        .left-column,
        .right-column {
          min-width: 0;
        }

        .left-column {
          column-count: 2;
        }


        .right-column {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .sub-panel {
          border: 1px solid var(--gray-bg);
          border-radius: 10px;
          padding: 16px;
          background: var(--gray-bg);
        }


        .subtitle, .hint {
          opacity: 1;
          justify-content: center;
        }

        .warning {
          color: var(--orange);
          font-weight: bold; }

        .error {
          color: var(--red);
        }



        /* ----------- Sources ---------- */
        button.players-toggle {
          border-color: var(--white-border);

        }

        button.players-toggle:hover {
          background: var(--gray);
        }


        /* ----------- Message box ---------- */
        .message-box {
          border-radius: 8px;
          padding: 12px;
          margin: 16px 0;
          font-size: 1.10rem;
        }

        .message-box p {
          margin: 6px 0;
        }


        /* ----------- Mode Button Parameters ---------- */
        /* Mode Space */
        .mode-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 24px;
          margin: 28px 0;
        }


        .mode-button {
          cursor: pointer;
          min-width: 320px;
          min-height: 64px;
          padding: 18px 28px;
          font-size: 1.50rem;
          font-weight: 900;
          border-radius: 12px;
          border: 1px solid;
          background: transparent;
          color: inherit;
          transition:
            background 0.15s ease,
            border-color 0.15s ease,
            color 0.15s ease;
        }


        /* -------- Learn Mode Button ----- */
        /* Hover bouton Création */
        .mode-button.learn-button:hover {
          background: var(--orange-bg);
          border-color: var(--white-border);
        }

        /* Hover bouton Jouer */
        .mode-button.play-button:hover {
          background: var(--red-bg);
          border-color: var(--white-border);
        }

        /* Mode Création actif */
        .mode-button.learn-button.active-mode {
          background: var(--orange-bg);
          border-color: var(--white-border);
        }

        /* Mode Jouer actif */
        .mode-button.play-button.active-mode {
          background: var(--red-bg);
          border-color: var(--white-border);
        }


        /* ---- Source ----- */
        .source-panel {
          padding: 12px 16px;
          margin: 16px 0;
        }

        .source-status {
          display: flex;
          align-items: center;
          gap: 20px;
          min-height: 10px;
          padding: 8px 12px;
        }


        .source-state {
          min-width: 120px;
        }



        /* -------- Master Control ----- */
        .master-controls {
          display: flex;
          justify-content: center;
          align-items: flex-end;
          gap: 80px;

          width: 100%;
          margin: 24px auto;
        }

        button.mute-button {
          min-width: 110px;
          min-height: 40px;
          background: var(--gray-bg);
          border-color: var(--white-border);
          font-size: 1.1rem;
          font-weight: 700;
        }


        button.mute-button:hover {
          background: var(--red-bg);
          border-color: var(--white-border);
        }

        button.mute-button.active-mute {
          background: var(--red-bg);
          border-color: var(--white-border);
        }

        button.mute-button.active-mute:hover {
          background: var(--green-bg);
        }


        .volume-control,
        .mute-control {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .volume-control {
          width: 200px;
          font-size: 1.1rem;
        }

        .volume-control sc-slider {
          width: 150%;
        }


        .control-label {
          font-size: 1.2rem;
          text-align: center;
        }



        /* ----------- Spaces ---------- */
        .sound-list, .examples-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .example-row, .example-group-header {
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: center;
          gap: 12px;
          padding: 8px;
          border-radius: 6px;
          background: var(--gray-bg);
        }

        .example-group {
          border: 1px solid #444;
          border-radius: 8px;
          padding: 12px;
        }

        .example-row {
          font-size: 1.10rem;
        }


        .sound-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: center;
          gap: 12px;
          padding: 8px;
          border-radius: 6px;
          background: var(--gray-bg);
          border: 1px solid var(--gray-bg) ;

        }

        .scroller {
          width: 950px;
          height: 600px;
          overflow-y: scroll;
          scrollbar-color: var(--white-border) transparent;
          scrollbar-width: thin;
        }





        /* ---------------- Button Parameters ---------------- */
        button {
          cursor: pointer;
          border: 1px solid var(--gray-bg);
          box-sizing: border-box;
          border-radius: 6px;
          padding: 8px 12px;
          background: transparent;
          color: inherit;
          transition:
            background 0.15s ease,
            border-color 0.15s ease;
        }



        /* ---- Listen / Stop Button---- */
        button.listen-button {
          background: var(--gray-bg);
          border-color: var(--white-border);
          min-width: 110px;
        }

        button.listen-button:hover {
          background: var(--gray);
          border-color: var(--white-border);
        }

        button.listen-button.active-mode {
          background: var(--red-bg);
          border-color: var(--white-border);
        }


        /* ----- Select Effect ----*/
        .sound-row.selected {
          border-color: var(--green-border);
        }

        /* ---- Select Button ---- */
        button.select-button {
          background: var(--gray-bg);
          border-color: var(--white-border);
          min-width: 120px;
        }

        button.select-button:hover {
          background: var(--green-bg);
          border-color: var(--white-border);
        }

        button.select-button.active-mode {
          background: var(--green-bg);
          border-color: var(--white-border);
        }


        /* ----------- Record Button ---------- */
        button.record {
          min-width: 120px;
          min-height: 40px;
          font-size: 1.20rem;
          font-weight: 700;
          border-color: var(--green-border);
          background: var(--gray-bg);
        }

        button.recording {
          background: var(--red-bg);
          border-color: var(--white-border);
          min-width: 120px;
          min-height: 40px;
          font-size: 1.20rem;
          font-weight: 700;
        }

        button.record:hover {
          background: var(--green-bg);
          border-color: var(--white-border);
        }


        /* ------- Delete Button-------- */
        button.delete-examples {
          border-color: var(--red-border);
        }

        button.delete-examples:hover {
          border-color: var(--white-border);
          background: var(--red-bg);
        }



        /* ------- Delete All Button-------- */
        button.delete-all {
          border-color: var(--red-border);
          font-size: 1.10rem;
        }

        button.delete-all:hover {
          border-color: var(--white-border);
          background: var(--red-bg);
        }


        /* ------ Disabled Button ------ */
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }




        /* ------------ Gesture Name ------------- */
        .gesture-name-control {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 18px 0;
        }

        .gesture-name-control label {
          font-size: 1.2rem;
          font-weight: 700;
        }

        .gesture-name-input {
          width:50%;
          box-sizing: border-box;
          padding: 10px 12px;
          border: 1px solid var(--white-border);
          border-radius: 6px;
          background: var(--gray-bg);
          color: inherit;
          font: inherit;
          min-width: 200px;
          min-height: 40px;
          font-size: 1.2rem;
        }

        .gesture-name-input:focus {
          outline: none;
          border-color: var(--blue);
        }

        .gesture-name-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }


        /* ------------ Preview Gesture  ------------- */
        button.preview-gesture-button {
          min-width: 120px;
          min-height: 40px;
          border-color: var(--orange);
          background: var(--gray-bg);
          font-size: 1.20rem;
        }


        button.preview-gesture-button:hover,
        button.preview-gesture-button.active-preview {
          background: var(--orange-bg);
          border-color: var(--white-border);
        }


        button.validate-gesture-button {
          min-width: 120px;
          min-height: 40px;
          border-color: var(--blue);
          font-size: 1.20rem;
        }

        button.validate-gesture-button:hover {
          background: var(--blue);
          border-color: var(--white-border);
        }

        button.delete-waiting-gesture {
          min-width: 120px;
          min-height: 40px;
          border-color: var(--red-border);
          background: var(--gray-bg);
          font-size: 1.20rem;
        }


        button.delete-waiting-gesture:hover {
          border-color: var(--white-border);
          background: var(--red-bg);
        }





        sc-dragndrop.sound-dragndrop {
          display: block;
          width: 100%;
          max-width: 620px;
          height: 120px;
          margin: 16px auto 24px;

          --sc-dragndrop-dragged-background-color:
            var(--blue);

          --sc-dragndrop-processing-background-color:
            var(--orange-bg);
        }

        sc-dragndrop.sound-dragndrop.disabled {
          opacity: 0.45;
          pointer-events: none;
          cursor: not-allowed;
        }

        .sound-drop-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;

          width: 100%;
          height: 100%;

          text-align: center;
        }

        .sound-drop-content strong {
          font-size: 1.2rem;
        }


        .sound-drop-content span {
          opacity: 0.75;
        }


      </style>

        ${renderCustomApp()}
    `, $container);
  }
}


launcher.execute(main, {
  numClients: parseInt(new URLSearchParams(window.location.search).get('emulate') || '') || 1,
  width: '50%',
});
