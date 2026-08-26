import {
  RECORD_COUNTDOWN_DELAY_MS,
  COUNTDOWN_SOUND_LABEL,
  RECORDING_DURATION_MS,
  WAITING_LABEL_PREFIX,
} from './config.js';



import {
  createModelLabel,
  syncExamplesToState,
  isValidExample,
} from './models.js';



let recordCountdownTimeout = null;
let recordStopTimeout = null;
let countdownAudioBuffer = null;
let recordExample = null;
let recordingInfos = null;
let waitingExample = null;
let waitingInfos = null;
let synth = null;
let model= null;



export function getWaitingInfos() {
  return waitingInfos;
}


export function initializeRecording(options) {
  model = options.model;
  synth = options.synth;
  countdownAudioBuffer = options.countdownAudioBuffer;
}


export function clearRecordingTimers() {

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
export async function startRecordingSequence(state) {

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
export async function beginTimedRecording(state) {
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





// ------------ Capture Recoding Frame  --------------
export function captureRecordingFrame(xmmFrame) {
  if (recordExample) {
    recordExample.push(xmmFrame);
  }
}




// ------------ Stop Recording Sequence  --------------
export async function stopRecordingSequence(state) {
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
export async function startRecording(state) {
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
      + `pour le son "${soundLabel}" pendant 4 secondes...`,

    lastError: '',
  });
}





// ------- Stop Recording and Prepare Preview --------
export async function stopRecordingAndPreparePreview(state) {
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
export async function validateWaitingGesture(state) {
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

  await syncExamplesToState(model, state);

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
export async function cancelWaitingGesture(state) {
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

  await syncExamplesToState(model, state);

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



export function resetRecording() {
  clearRecordingTimers();

  recordExample = null;
  recordingInfos = null;
  waitingExample = null;
  waitingInfos = null;

  countdownAudioBuffer = null;
  synth = null;
  model = null;
}

















