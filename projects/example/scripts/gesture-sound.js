import { Intensity } from '@ircam/sc-motion/Intensity.js';
import { CategoricalHysteresis } from '@ircam/sc-signal/CategoricalHysteresis.js';
import { GestureSoundSynth } from '../../../src/utils/GestureSoundSynth.js';


const {
  audioContext,
  como,
} = getGlobalScriptingContext();



const MODEL_ID = 'gesture-sound_short';
const MODEL_PRESET = 'shortGestures';
const FRAME_TIMEOUT_MS = 500;
const FRAME_TIMEOUT_INTERVAL_MS = 200;
const WAITING_LABEL_PREFIX = '__waiting__:';
const MODEL_LABEL_SEPARATOR = '|||';


const COUNTDOWN_SOUND_URL = 'http://192.168.1.60:8000/assets/Voice-record.wav';
const COUNTDOWN_SOUND_LABEL = 'Voice-record.wav';
const RECORD_COUNTDOWN_DELAY_MS = 4000; // Recording starts 4 seconds after the countdown
const RECORDING_DURATION_MS = 4000; // The recording lasts exactly 4 seconds


// Intensity Parameters
const INTENSITY_WINDOW_SIZE = 3;
const INTENSITY_FEEDBACK = 0.7;
const INTENSITY_PROCESS_GAIN = 0.07;

// Categorical buffer size
const HYSTERESIS_BUFFER_SIZE = 15;


let model = null;
let synth = null;

let unsubscribeState = null;
let unsubscribeModel = null;
let lastClearAllRequest = 0;
let frameTimeoutInterval = null;
let lastFrameTime = 0;
let waitingExample = null;
let waitingInfos = null;

let recordExample = null;
let recordingInfos = null;
let recordCountdownTimeout = null;
let recordStopTimeout = null;
let countdownAudioBuffer = null;

let intensityProcessor = null;
let previewHysteresis= null;
let playHysteresis= null;
let loadedUserSoundLabels = new Set();




// -------- Share State ----------
export async function defineSharedState() {
  return {
    classDescription: {

      labels: {
        type: 'any',
        default: [],
      },

      userSoundFiles: {
        type: 'any',
        default: [],
      },

      reloadUserSoundsRequest: {
        type: 'integer',
        default: 0,
      },

      selectedLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },

      gestureName: {
        type: 'string',
        default: '',
      },

      previewLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },

      record: {
        type: 'boolean',
        default: false,
      },

      mode: {
        type: 'string',
        default: 'learn',
      },

      training: {
        type: 'boolean',
        default: false,
      },

      recognizedLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },

      waitingGesture: {
        type: 'any',
        default: null,
        nullable: true,
      },

      waitingPreview: {
        type: 'boolean',
        default: false,
      },

      validateWaitingRequest: {
        type: 'integer',
        default: 0,
      },

      cancelWaitingRequest: {
        type: 'integer',
        default: 0,
      },

      examples: {
        type: 'any',
        default: {},
      },

      deleteExampleUuid: {
        type: 'string',
        default: null,
        nullable: true,
      },

      clearLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },

      clearAllRequest: {
        type: 'integer',
        default: 0,
      },

      status: {
        type: 'string',
        default: 'idle',
      },

      lastMessage: {
        type: 'string',
        default: '',
      },

      lastError: {
        type: 'string',
        default: '',
      },
    },

    initValues: {},
  };
}



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
    countdownAudioBuffer = await fetchAudioBuffer(COUNTDOWN_SOUND_URL);

  } catch (error) {
    console.warn(
      `Impossible de charger le son de décompte : ${COUNTDOWN_SOUND_URL}`,
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

  await clearWaitingExamples();
  await syncExamplesToState(state);

  unsubscribeModel = model.state.onUpdate(updates => {
    if ('infos' in updates || 'parameters' in updates) {
      syncExamplesToState(state);
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
        await loadUserSounds(state);
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
        await deleteExample(state, updates.deleteExampleUuid);
      }

      if ('clearLabel' in updates && updates.clearLabel) {
        await clearExamplesForLabel(state, updates.clearLabel);
      }

      if ('clearAllRequest' in updates) {
        const nextRequest = updates.clearAllRequest;

        if (nextRequest > lastClearAllRequest) {
          lastClearAllRequest = nextRequest;
          await clearAllExamples(state);
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
  clearRecordingTimers();

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

  recordExample = null;
  loadedUserSoundLabels.clear();

}





// ---------- Process () --------------------
export async function process(context, frame) {
  lastFrameTime = performance.now();

  const { state } = context;
  const motionFrame = frame?.[0];

  if (
    !motionFrame
    || !motionFrame.accelerometer
    || !motionFrame.gyroscope
    || !motionFrame.gravity
  ) {
    return;
  }

  if (!intensityProcessor) {
    return;
  }


  if (!model || state.get('training')) {
    return;
  }

  let intensity = null;

  try {
    intensity = intensityProcessor.process({
      api: motionFrame.api || 'v3',
      timestamp: Number.isFinite(motionFrame.timestamp)
        ? motionFrame.timestamp
        : performance.now(),

      accelerometer:
      motionFrame.accelerometer,
    });
  } catch (error) {
    console.error('Erreur Intensity :', error);
    return;
  }

  const intensityNorm = Number.isFinite(intensity?.norm)
    ? intensity.norm
    : 0;


  const isWaitingPreview = state.get('waitingPreview') === true;
  const isPlayMode = state.get('mode') === 'play';
  const intensityControlsAudio = isWaitingPreview || isPlayMode;

  if (intensityControlsAudio) {
    synth?.setIntensity(intensityNorm);
  } else {
    synth?.resetIntensityGain();
  }


  // XMM Frame
  const xmmFrame = [

    //Accelerometer
    motionFrame.accelerometer.x,
    motionFrame.accelerometer.y,
    motionFrame.accelerometer.z,

    //Gyroscope
    motionFrame.gyroscope.x,
    motionFrame.gyroscope.y,
    motionFrame.gyroscope.z,

    //Gravity
    motionFrame.gravity.x,
    motionFrame.gravity.y,
    motionFrame.gravity.z,

    //Intensity
    intensityNorm,

  ];

  if (state.get('record')) {
    if (recordExample) {
      recordExample.push(xmmFrame);
    }

    return;
  }


  //Apart from the temporary test, normal
  // recognition works only in play mode.
  if (
    !isWaitingPreview
    && state.get('mode') !== 'play'
  ) {
    return;
  }

  let results = null;

  try {
    results = model.process(xmmFrame);
  } catch (err) {
    console.error('Erreur process :', err);
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


  // ----------- Preview Recognition -----------
  if (isWaitingPreview) {
    if (!waitingInfos) {
      synth?.stopAll({
        fade: true,
        fadeOutTime: 0.2,
      });

      return;
    }

    const temporaryLabel = waitingInfos.temporaryLabel;

    let previewWinnerLabel = null;
    let previewWinnerScore = -Infinity;

    labels.forEach((label, index) => {
      // We accept the current preview gesture,
      // and all gestures that have already been approved.

      // We ignore only any previous preview gestures
      // that do not correspond to the current gesture.
      const isOtherWaitingLabel =
        label.startsWith(WAITING_LABEL_PREFIX)
        && label !== temporaryLabel;

      if (isOtherWaitingLabel) {
        return;
      }

      const score = Number(scores[index]);

      if (Number.isFinite(score) && score > previewWinnerScore) {
        previewWinnerLabel = label;
        previewWinnerScore = score;
      }
    });


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


  // --------- Play Recognition ------------
  let winnerLabel = null;
  let winnerScore = -Infinity;


  labels.forEach((label, index) => {
    // Never use a temporary gesture in Play mode
    if (label.startsWith(WAITING_LABEL_PREFIX)) {
      return;
    }

    const score = Number(scores[index]);

    if (Number.isFinite(score) && score > winnerScore) {
      winnerLabel = label;
      winnerScore = score;
    }
  });

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




// --------- Create Model Label ----------
function createModelLabel(gestureName, soundLabel) {
  return [
    encodeURIComponent(gestureName.trim()),
    encodeURIComponent(soundLabel),
  ].join(MODEL_LABEL_SEPARATOR);
}

function parseModelLabel(modelLabel) {
  const parts = modelLabel.split(MODEL_LABEL_SEPARATOR);

  // Backward Compatibility with Previous Examples
  if (parts.length !== 2) {
    return {
      gestureName: modelLabel,
      soundLabel: modelLabel,
    };
  }

  return {
    gestureName: decodeURIComponent(parts[0]),
    soundLabel: decodeURIComponent(parts[1]),
  };
}




function clearRecordingTimers() {

  if (recordCountdownTimeout) {
    clearTimeout(recordCountdownTimeout);
    recordCountdownTimeout = null;
  }

  if (recordStopTimeout) {
    clearTimeout(recordStopTimeout);
    recordStopTimeout = null;
  }

}



// -------- Star Recording Sequence: Countdown + Timed Recording ------------
async function startRecordingSequence(state) {

  clearRecordingTimers();

  const soundLabel = state.get('selectedLabel');
  const gestureName = state.get('gestureName')?.trim();

  if (!soundLabel) {

    recordExample = null;
    recordingInfos = null;

    await state.set({
      record: false,
      status: 'error',
      lastError: 'Aucun son sélectionné pour enregistrer le geste.',

    });

    return;

  }

  if (!gestureName) {

    recordExample = null;
    recordingInfos = null;

    await state.set({
      record: false,
      status: 'error',
      lastError: 'Veuillez donner un nom au geste avant de commencer.',

    });

    return;

  }

  const modelLabel = createModelLabel(
    gestureName,
    soundLabel,
  );

  recordingInfos = {
    gestureName,
    soundLabel,
    modelLabel,

  };


  // No frames have been recorded yet
  recordExample = null;

  synth?.stopAll({
    fade: true,
    fadeOutTime: 0.1,

  });

  const countdownChannel = synth?.playBuffer(countdownAudioBuffer, {
    gain: 1,
  });

  await state.set({

    mode: 'learn',
    training: false,
    recognizedLabel: null,
    waitingPreview: false,
    status: 'record-countdown',

    lastMessage:
      `Préparez-vous : enregistrement du geste "${gestureName}" `
      + `pour le son "${soundLabel}" dans 3 secondes...`,

    lastError: countdownChannel
      ? ''
      : `Son de décompte introuvable : "${COUNTDOWN_SOUND_LABEL}". `
      + 'L’enregistrement commencera quand même.',

  });

  recordCountdownTimeout = setTimeout(() => {

    recordCountdownTimeout = null;

    void beginTimedRecording(state)
      .catch(async error => {
        console.error('Erreur pendant le démarrage différé :', error);

        await state.set({
          record: false,
          training: false,
          status: 'error',
          lastError: error?.message || String(error),
        });
      });

  }, RECORD_COUNTDOWN_DELAY_MS);

}


// ------- Begin Timed Recording --------
async function beginTimedRecording(state) {
  if (!state.get('record')) {
    return;
  }

  if (!recordingInfos) {
    await state.set({
      record: false,
      status: 'error',
      lastError: 'Impossible de démarrer l’enregistrement : informations manquantes.',
    });

    return;
  }

  await startRecording(state);

  recordStopTimeout = setTimeout(() => {
    recordStopTimeout = null;

    void state.set({
      record: false,
    }).catch(error => {
      console.error('Erreur pendant l’arrêt automatique :', error);
    });
  }, RECORDING_DURATION_MS);
}


// ------------ Stop Recording Sequence  --------------
async function stopRecordingSequence(state) {
  clearRecordingTimers();

  // Case where the user cancels during the countdown
  if (!recordExample) {
    recordingInfos = null;

    synth?.stopAll({
      fade: true,
      fadeOutTime: 0.1,
    });

    await state.set({
      status: 'ready',
      lastMessage: 'Enregistrement annulé.',
      lastError: '',
    });

    return;
  }

  // Cases where actual recording has begun
  await stopRecordingAndPreparePreview(state);
}



// ------- Start Recording --------
async function startRecording(state) {
  if (!recordingInfos) {
    recordExample = null;

    await state.set({
      record: false,
      status: 'error',
      lastError: 'Impossible de démarrer l’enregistrement : informations manquantes.',
    });

    return;
  }

  const {
    gestureName,
    soundLabel,
  } = recordingInfos;

  recordExample = [];

  await state.set({
    mode: 'learn',
    training: false,
    recognizedLabel: null,
    status: 'recording',
    lastMessage:
      `Enregistrement du geste "${gestureName}" `
      + `pour le son "${soundLabel}" pendant 3 secondes...`,

    lastError: '',
  });
}



// ------- Stop Recording and Prepare Preview --------
async function stopRecordingAndPreparePreview(state) {
  if (!recordExample) {

    return;

  }

  const example = recordExample;
  const infos = recordingInfos;


  recordExample = null;
  recordingInfos = null;

  if (!infos) {

    await state.set({
      status: 'error',
      lastError: 'Impossible de préparer le geste : informations manquantes.',
    });

    return;

  }

  const {
    gestureName,
    soundLabel,
    modelLabel,
  } = infos;



  if (!soundLabel) {
    await state.set({
      status: 'error',
      lastError: 'Impossible de préparer le geste : aucun son sélectionné.',
    });

    return;
  }

  if (!gestureName) {
    await state.set({
      status: 'error',
      lastError: 'Veuillez donner un nom au geste.',
    });

    return;
  }

  if (!isValidExample(example)) {
    await state.set({
      status: 'ready',
      lastError: 'Exemple vide ou invalide. Recommencez le geste.',
    });

    return;
  }

  const temporaryLabel = `${WAITING_LABEL_PREFIX}${Date.now()}`;

  const finalLabel = modelLabel;

  waitingExample = example;

  waitingInfos = {
    temporaryLabel,
    finalLabel,
    gestureName,
    soundLabel,
  };

  await state.set({
    training: true,
    status: 'preparing-preview',
    lastMessage: `Préparation du test du geste "${gestureName}"...`,
    lastError: '',
  });


  // Temporary addition in XMM
  await model.addExample(
    temporaryLabel,
    example,
  );

  await state.set({
    waitingGesture: {
      gestureName,
      soundLabel,
    },

    waitingPreview: false,
    training: false,
    status: 'waiting-validation',
    lastMessage: `Le geste "${gestureName}" est prêt à être testé.`,
  });
}



// ------- Validate Waiting Gesture --------
async function validateWaitingGesture(state) {
  if (!waitingExample || !waitingInfos) {
    await state.set({
      lastError: 'Aucun geste temporaire à valider.',
    });

    return;
  }

  const {
    temporaryLabel,
    finalLabel,
    gestureName,
    soundLabel,
  } = waitingInfos;

  synth?.stopAll({
    fade: true,
    fadeOutTime: 0.1,
  });

  await state.set({
    waitingPreview: false,
    training: true,
    status: 'validating-gesture',
    lastMessage: `Validation du geste "${gestureName}"...`,
    lastError: '',
  });


  // Permanent addition
  await model.addExample(
    finalLabel,
    waitingExample,
  );

  // Deleting the temporary class
  await model.clearExamples(temporaryLabel);

  waitingExample = null;
  waitingInfos = null;

  await syncExamplesToState(state);

  await state.set({
    waitingGesture: null,
    waitingPreview: false,
    validateWaitingRequest: 0,
    gestureName: '',
    training: false,
    status: 'ready',
    lastMessage: `Geste "${gestureName}" associé au son "${soundLabel}".`,
  });
}


// ------- Cancel Waiting Gesture --------
async function cancelWaitingGesture(state) {
  synth?.stopAll({
    fade: true,
    fadeOutTime: 0.1,
  });

  if (waitingInfos?.temporaryLabel) {
    await model.clearExamples(
      waitingInfos.temporaryLabel,
    );
  }

  const gestureName = waitingInfos?.gestureName || 'le geste';

  waitingExample = null;
  waitingInfos = null;

  await syncExamplesToState(state);

  await state.set({
    waitingGesture: null,
    waitingPreview: false,
    cancelWaitingRequest: 0,
    training: false,
    recognizedLabel: null,
    status: 'ready',
    lastMessage: `Enregistrement de "${gestureName}" annulé.`,
    lastError: '',
  });
}


// --------- Clear Waiting Examples ----------
async function clearWaitingExamples() {
  if (!model) {
    return;
  }

  const infos = model.state.get('infos') || {};
  const labels = Object.keys(infos);

  for (const label of labels) {
    if (label.startsWith(WAITING_LABEL_PREFIX)) {
      await model.clearExamples(label);
    }
  }
}



// ------- Delete Example --------
async function deleteExample(state, uuid) {
  await state.set({
    training: true,
    status: 'deleting-example',
    lastMessage: 'Suppression du geste...',
    lastError: '',
  });

  await model.deleteExample(uuid);
  await syncExamplesToState(state);

  await state.set({
    deleteExampleUuid: null,
    training: false,
    status: 'ready',
    lastMessage: 'Geste supprimé.',
  });
}


// ------- Delete All Example --------
async function clearExamplesForLabel(state, label) {
  await state.set({
    training: true,
    status: 'clearing-label',
    lastMessage: `Suppression des gestes pour "${label}"...`,
  });

  await model.clearExamples(label);
  await syncExamplesToState(state);

  await state.set({
    clearLabel: null,
    training: false,
    status: 'ready',
    lastMessage: `Tous les gestes pour "${label}" ont été supprimés.`,
  });
}



// ------ Clear all Examples ------
async function clearAllExamples(state) {
  await state.set({
    training: true,
    status: 'clearing-all',
    lastMessage: 'Suppression de tous les gestes...',
  });

  await model.clearExamples();
  await syncExamplesToState(state);

  await state.set({
    training: false,
    status: 'ready',
    recognizedLabel: null,
    lastMessage: 'Tous les gestes ont été supprimés.',
  });
}


// ------ Sync Examples from Model State to Shared State -----
async function syncExamplesToState(state) {
  if (!model) {
    return;
  }

  const infos = model.state.get('infos') || {};
  const examples = {};

  for (const [modelLabel, modelInfos] of Object.entries(infos)) {

    // Temporary labels are not displayed
    if (modelLabel.startsWith(WAITING_LABEL_PREFIX)
    ) {
      continue;
    }

    const {
      gestureName,
      soundLabel,
    } = parseModelLabel(modelLabel);

    examples[modelLabel] = {
      ...modelInfos,
      gestureName,
      soundLabel,
    };
  }

  await state.set({ examples });
}


// ------ Validate Example Format --------
function isValidExample(example) {
  if (!Array.isArray(example) || example.length === 0) {
    return false;
  }

  if (!Array.isArray(example[0])) {
    return false;
  }

  const dimension = example[0].length;

  if (dimension <= 0) {
    return false;
  }

  return example.every(frame => {
    return Array.isArray(frame)
      && frame.length === dimension
      && frame.every(value => Number.isFinite(value));
  });
}




// --------- Fetch Audio Buffer -------------
async function fetchAudioBuffer(url) {
  const response = await fetch(url, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Impossible de charger le fichier audio : HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  return await audioContext.decodeAudioData(arrayBuffer.slice(0));
}



// --------- Load User Sounds -------------
async function loadUserSounds(state) {
  if (!synth) {
    return;
  }

  const userSoundFiles = state.get('userSoundFiles') || [];

  if (!Array.isArray(userSoundFiles)) {
    return;
  }


  // Current list of files present
  // in the Filesystem plugin
  const nextUserSoundLabels = new Set(
    userSoundFiles.map(soundFile => {
      return String(soundFile?.label || '').trim();
    }).filter(Boolean),
  );


  // Removes user files from the synthesizer that
  // have been deleted from the server
  for (const label of loadedUserSoundLabels) {
    if (!nextUserSoundLabels.has(label)) {
      synth.removeSound(label);
    }
  }

  let loadedCount = 0;
  const errors = [];


  //Load the new files in the Filesystem plugin.
  for (const soundFile of userSoundFiles) {
    const label = String(soundFile?.label || '').trim();
    const url = soundFile?.url;

    if (!label || !url) {
      continue;
    }

    if (synth.hasSound(label)) {
      continue;
    }

    try {
      const audioBuffer = await fetchAudioBuffer(url);
      synth.addSound(label, audioBuffer);

      loadedCount += 1;
    } catch (error) {
      console.error(`Impossible de charger "${label}" :`, error);

      errors.push(label);
    }
  }


  // Save the current list so you can detect future deletions.
  loadedUserSoundLabels = nextUserSoundLabels;

  const nextLabels = synth.labels.sort((a, b) => {
    return a.localeCompare(b);
  });

  const currentSelectedLabel = state.get('selectedLabel');
  const nextSelectedLabel = currentSelectedLabel && nextLabels.includes(currentSelectedLabel)
    ? currentSelectedLabel
    : nextLabels[0] || null;

  const currentPreviewLabel = state.get('previewLabel');
  const nextPreviewLabel = currentPreviewLabel && nextLabels.includes(currentPreviewLabel)
    ? currentPreviewLabel
    : null;

  await state.set({
    labels: nextLabels,
    selectedLabel: nextSelectedLabel,
    previewLabel: nextPreviewLabel,
    status: errors.length > 0
      ? 'sound-loading-error'
      : 'ready',

    lastMessage: loadedCount > 0
      ? `${loadedCount} nouveau(x) son(s) chargé(s).`
      : state.get('lastMessage'),

    lastError: errors.length > 0
      ? `Impossible de charger : ${errors.join(', ')}`
      : '',
  });
}


