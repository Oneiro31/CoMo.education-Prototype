
const {
  audioContext,
} = getGlobalScriptingContext();


let loadedUserSoundLabels = new Set();


// --------- Fetch Audio Buffer -------------
export async function fetchAudioBuffer(url) {
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
export async function loadUserSounds(state, synth) {
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
