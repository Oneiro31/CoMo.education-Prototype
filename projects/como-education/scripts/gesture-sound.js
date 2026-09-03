import { Intensity } from '@ircam/sc-motion/Intensity.js';
import { CategoricalHysteresis } from '@ircam/sc-signal/CategoricalHysteresis.js';
import { GestureSoundSynth } from '../../../src/utils/GestureSoundSynth.js';


import {
  INTENSITY_WINDOW_SIZE,
  INTENSITY_FEEDBACK,
  INTENSITY_PROCESS_GAIN,
  HYSTERESIS_BUFFER_SIZE,
  COUNTDOWN_SOUND_PATH,
  MODEL_ID,
  MODEL_PRESET,
  FRAME_TIMEOUT_MS,
  FRAME_TIMEOUT_INTERVAL_MS,
  WAITING_LABEL_PREFIX,
} from '../../../src/utils/config.js';



import {
  parseModelLabel,
  syncExamplesToState,
  clearWaitingExamples,
  deleteExample,
  clearExamplesForLabel,
  clearAllExamples,
} from '../../../src/utils/models.js';



import {
  stopRecordingSequence,
  startRecordingSequence,
  validateWaitingGesture,
  cancelWaitingGesture,
  initializeRecording,
  captureRecordingFrame,
  getWaitingInfos,
  resetRecording,
} from '../../../src/utils/recording.js';



import {
  isMotionFrameValid,
  computeIntensity,
  buildXmmFrame,
  findBestLabel,
} from '../../../src/utils/recognition.js';


import {
  fetchAudioBuffer,
  loadUserSounds,
} from '../../../src/utils/audio-files.js';




const {
  audioContext,
  como,
} = getGlobalScriptingContext();


let model = null;
let synth = null;

let unsubscribeState = null;
let unsubscribeModel = null;
let lastClearAllRequest = 0;

let frameTimeoutInterval = null;
let lastFrameTime = 0;
let countdownAudioBuffer = null;

let intensityProcessor = null;
let previewHysteresis= null;
let playHysteresis= null;


export {
  defineSharedState,
} from '../../../src/utils/shared-state.js';




// --------------- Enter () ----------------
export async function enter(context) {
  const {
    state,
    soundbank,
    output,
  } = context;


  intensityProcessor = new Intensity({
    windowSize: INTENSITY_WINDOW_SIZE,
    feedback: INTENSITY_FEEDBACK,
    gain: INTENSITY_PROCESS_GAIN,
  });

  previewHysteresis = new CategoricalHysteresis({
    bufferSize: HYSTERESIS_BUFFER_SIZE,
  });

  playHysteresis = new CategoricalHysteresis({
    bufferSize: HYSTERESIS_BUFFER_SIZE,
  });

  synth = new GestureSoundSynth({
    audioContext,
    soundbank,
    output,
  });


  try {
    const countdownSoundUrl =
      getServerAssetUrl(COUNTDOWN_SOUND_PATH);

    countdownAudioBuffer =
      await fetchAudioBuffer(countdownSoundUrl);


  } catch (error) {
    console.warn(
      `Impossible de charger le son de décompte : ${countdownSoundUrl}`,
      error,
    );

    countdownAudioBuffer = null;
  }


  lastFrameTime = performance.now();

  frameTimeoutInterval = setInterval(() => {
    if (!synth || !state) {
      return;
    }

    const now = performance.now();
    const time = now - lastFrameTime;
    const isPlaying = state.get('mode') === 'play';

    if (isPlaying && time > FRAME_TIMEOUT_MS) {
      synth.stopAll({
        fade: true,
        fadeOutTime: 0.05,
      });

      state.set({
        recognizedLabel: null,
        status: 'source-timeout',
        lastMessage: 'Arret du son',
        lastError: 'Pas de données IMU',
      });
    }
  }, FRAME_TIMEOUT_INTERVAL_MS);


  const labels = Object.keys(soundbank);

  await state.set({
    labels,
    userSoundFiles: [],
    reloadUserSoundsRequest: 0,

    selectedLabel: labels.length > 0 ? labels[0] : null,
    gestureName:'',
    previewLabel: null,
    record: false,
    mode: 'learn',
    training: false,
    recognizedLabel: null,
    examples: {},

    waitingGesture: null,
    waitingPreview: false,
    validateWaitingRequest: 0,
    cancelWaitingRequest: 0,

    status: 'loading-model',
    lastMessage: 'Chargement du modèle XMM...',
  });



  model = await como.modelManager.getModel(MODEL_ID, {
    preset: MODEL_PRESET,
  });

  initializeRecording({
    model,
    synth,
    countdownAudioBuffer,
  });

  await clearWaitingExamples(model);
  await syncExamplesToState(model, state);


  unsubscribeModel = model.state.onUpdate(updates => {
    if ('infos' in updates || 'parameters' in updates) {
      void syncExamplesToState(model, state)
        .catch(error => {
          console.error(
            'Erreur de synchronisation des exemples :',
            error,
          );
        });
    }
  }, true);

  lastClearAllRequest = state.get('clearAllRequest') || 0;

  unsubscribeState = state.onUpdate(async updates => {
    try {

      if (
        'userSoundFiles' in updates
        || 'reloadUserSoundsRequest'
        in updates
      ) {
        await loadUserSounds(state, synth);
      }


      if ('previewLabel' in updates) {
        const label = updates.previewLabel;

        if (label) {
          const channel = synth.preview(label, {
            onEnded: () => {

              if (state.get('previewLabel') === label) {
                state.set({
                  previewLabel: null,
                  lastMessage: `Lecture terminée : "${label}"`,
                }).catch(err => {
                  console.error('erreur de fin de preview :', err);
                });
              }
            },
          });

          if (!channel) {
            await state.set({
              previewLabel: null,
              lastError: `Impossible de lire le son "${label}".`,
            });

            return;
          }

          await state.set({
            lastMessage: `Lecture de "${label}"`,
            lastError: '',
          });
        } else {
          synth.stopAll({
            fade: true,
            fadeOutTime: 0.1,
          });

          await state.set({
            lastMessage: 'Lecture arrêtée.',
          });
        }
      }


      if ('selectedLabel' in updates) {
        if (synth) {
          synth.stopAll({
            fade: true,
            fadeOutTime: 0.1,
          });
        }

        await state.set({
          recognizedLabel: null,
          status: 'ready',
          lastMessage: updates.selectedLabel
            ? `Son sélectionné : ${updates.selectedLabel}`
            : 'Aucun son sélectionné',
        });

      }


      if ('record' in updates) {
        if (updates.record === true) {
          await startRecordingSequence(state);
        } else {
          await stopRecordingSequence(state);
        }
      }



      if ('mode' in updates) {
        previewHysteresis?.init();
        playHysteresis?.init();

        if (updates.mode !== 'play' && synth) {
          synth.stopAll({
            fade: false,
          });

          synth.resetIntensityGain();
        }

        await state.set({
          recognizedLabel: null,
          status: updates.mode === 'play'
            ? 'playing'
            : 'ready',
          lastMessage: updates.mode === 'play'
            ? 'Mode de jeu activé'
            : 'Mode d’apprentissage activé',
        });
      }


      if ('validateWaitingRequest' in updates && updates.validateWaitingRequest > 0) {
        await validateWaitingGesture(state);
      }

      if ('cancelWaitingRequest' in updates && updates.cancelWaitingRequest > 0) {
        await cancelWaitingGesture(state);
      }

      if ('waitingPreview' in updates) {
        previewHysteresis?.init();

        if (updates.waitingPreview === true) {
          await state.set({
            recognizedLabel: null,
            status: 'previewing-waiting',
            lastMessage: 'Test actif : refaites maintenant le geste enregistré.',
            lastError: '',
          });
        } else {
          synth?.stopAll({
            fade: true,
            fadeOutTime: 0.1,
          });

          await state.set({
            recognizedLabel: null,
            status: 'waiting-validation',
            lastMessage: 'Test arrêté. Validez ou annulez le geste.',
          });
        }
      }


      if ('deleteExampleUuid' in updates && updates.deleteExampleUuid) {
        await deleteExample(model, state, updates.deleteExampleUuid);
      }

      if ('clearLabel' in updates && updates.clearLabel) {
        await clearExamplesForLabel(model, state, updates.clearLabel);
      }

      if ('clearAllRequest' in updates) {
        const nextRequest = updates.clearAllRequest;

        if (nextRequest > lastClearAllRequest) {
          lastClearAllRequest = nextRequest;
          await clearAllExamples(model, state);
        }
      }
    } catch (err) {
      console.error('state update error:', err);

      await state.set({
        training: false,
        status: 'error',
        lastError: err.message || String(err),
      });
    }
  });

  await state.set({
    status: 'ready',
    lastMessage: 'Application prête.',
  });
}




// -------------- Exit () ------------------
export async function exit() {
  resetRecording();

  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }


  if (unsubscribeModel) {
    unsubscribeModel();
    unsubscribeModel = null;
  }

  if (synth) {
    synth.disconnect();
    synth= null;
  }

  if (model) {
    await model.detach();
    model = null;
  }

  if (frameTimeoutInterval) {
    clearInterval(frameTimeoutInterval);
    frameTimeoutInterval = null;
  }

  if (intensityProcessor) {
    intensityProcessor.reset();
    intensityProcessor = null;
  }


  if (previewHysteresis) {
    previewHysteresis.init();
    previewHysteresis = null;
  }

  if (playHysteresis) {
    playHysteresis.init();
    playHysteresis = null;
  }
}



// ---------- Process () --------------------
export async function process(context, frame) {

  const { state } = context;
  const motionFrame = frame?.[0];


  if (
    !isMotionFrameValid(motionFrame)
    || !intensityProcessor
    || !model
    || state.get('training')
  ) {
    return;
  }

  lastFrameTime = performance.now();

  // ---------- Calculation of intensity ----------
  let intensityNorm = 0;

  try {
    intensityNorm = computeIntensity(
      intensityProcessor,
      motionFrame,
    );
  } catch (error) {
    console.error('Erreur Intensity :', error);
    return;
  }

  const isWaitingPreview = state.get('waitingPreview') === true;
  const isPlayMode = state.get('mode') === 'play';

  if (isWaitingPreview || isPlayMode) {
    synth?.setIntensity(intensityNorm);
  } else {
    synth?.resetIntensityGain();
  }


  // ---------- Construction of the XMM frame ----------
  const xmmFrame = buildXmmFrame(
    motionFrame,
    intensityNorm,
  );

  // ---------- Recording ----------
  if (state.get('record') === true) {
    captureRecordingFrame(xmmFrame);
    return;
  }

  // Apart from the temporary test,
  // recognition only works in Play mode.
  if (!isWaitingPreview && !isPlayMode) {
    return;
  }


  let results = null;

  try {
    results = model.process(xmmFrame);
  } catch (err) {
    console.error('Erreur de reconnaissance XMM :', err);
    return;
  }

  if (!results) {
    return;
  }

  const labels = results.labels;
  const scores = results.smoothedNormalizedLikelihoods;

  if (
    !Array.isArray(labels)
    || !scores
    || labels.length === 0
  ) {
    return;
  }


  // ============================================
  //             Preview Recognition
  // ============================================
  if (isWaitingPreview) {
    const waitingInfos = getWaitingInfos();

    if (!waitingInfos) {
      synth?.stopAll({
        fade: true,
        fadeOutTime: 0.2,
      });

      return;
    }


    const temporaryLabel = waitingInfos.temporaryLabel;

    let previewWinnerLabel = findBestLabel(
      labels,
      scores,
      label => {
        // We accept the current preview gesture,
        // and all gestures that have already been approved.

        // We ignore only any previous preview gestures
        // that do not correspond to the current gesture.
        const isOtherWaitingLabel =
          label.startsWith(WAITING_LABEL_PREFIX)
          && label !== temporaryLabel;

        return !isOtherWaitingLabel;

      },
    );


    // Temporal stabilization of the result
    let stabilizedPreviewLabel = null;

    if (previewWinnerLabel && previewHysteresis) {
      stabilizedPreviewLabel = previewHysteresis.process(previewWinnerLabel);
    }

    const accepted = stabilizedPreviewLabel === temporaryLabel;


    if (accepted) {
      synth?.loop(waitingInfos.soundLabel, {
        fadeInTime: 0.2,
        fadeOutTime: 0.1,
      });

      if (
        state.get('recognizedLabel')
        !== waitingInfos.gestureName
      ) {
        state.set({
          recognizedLabel: waitingInfos.gestureName,
          status: 'preview-recognized',
          lastMessage: `Geste reconnu : ${waitingInfos.gestureName}`,
          lastError: '',
        });
      }
    } else {
      synth?.stopAll({
        fade: true,
        fadeOutTime: 0.2,
      });

      if (
        state.get('recognizedLabel') !== null
        || state.get('status')
        !== 'preview-not-recognized'
      ) {
        state.set({
          recognizedLabel: null,
          status: 'preview-not-recognized',
          lastMessage: 'Geste testé non reconnu.',
          lastError: '',
        });
      }
    }

    return;
  }



  // ============================================
  //               Play Recognition
  // ============================================


  const winnerLabel = findBestLabel(
    labels,
    scores,
    label => {
      // Never use a temporary gesture in Play mode
      return !label.startsWith(WAITING_LABEL_PREFIX);
    },
  );


  let stabilizedWinnerLabel = null;

  if (winnerLabel && playHysteresis) {
    stabilizedWinnerLabel = playHysteresis.process(winnerLabel);
  }


  if (!stabilizedWinnerLabel) {
    synth?.stopAll({
      fade: true,
      fadeOutTime: 0.3,
    });


    if (state.get('recognizedLabel') !== null
      || state.get('status')
      !== 'playing') {
      state.set({
        recognizedLabel: null,
        status: 'playing',
        lastMessage: 'Aucun geste reconnu.',
        lastError: '',
      });
    }

    return;
  }

  if (!synth) {
    return;
  }


  const {
    gestureName,
    soundLabel,
  } = parseModelLabel(stabilizedWinnerLabel);


  synth.loop(soundLabel, {
    fadeInTime: 0.2,
    fadeOutTime: 0.1,
  });


  if (state.get('recognizedLabel') !== gestureName) {
    state.set({
      recognizedLabel: gestureName,
      status: 'recognized',
      lastMessage: `Geste reconnu : ${gestureName} — son : ${soundLabel}`,
      lastError: '',
    });
  }
}



function getServerAssetUrl(assetPath) {
  const {
    useHttps,
    serverAddress,
    port,
    baseUrl = '',
  } = como.host.config.env;

  const protocol = useHttps
    ? 'https'
    : 'http';

  const hostname =
    serverAddress || '127.0.0.1';

  const normalizedBaseUrl = baseUrl
    ? `/${baseUrl.replace(/^\/+|\/+$/g, '')}`
    : '';

  const normalizedAssetPath =
    `/${assetPath.replace(/^\/+/, '')}`;

  return (
    `${protocol}://${hostname}:${port}`
    + normalizedBaseUrl
    + normalizedAssetPath
  );
}

