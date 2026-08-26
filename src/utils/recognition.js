



//-------------- Verification of the frame -------------------
export function isMotionFrameValid(frame) {
  return Boolean(
    frame
    && frame.accelerometer
    && frame.gyroscope
    && frame.gravity,
  );
}


//-------------- Compute Intensity -------------------
export function computeIntensity(intensityProcessor, motionFrame) {
  const intensity = intensityProcessor.process({
    api: motionFrame.api || 'v3',
    timestamp: Number.isFinite(motionFrame.timestamp)
      ? motionFrame.timestamp
      : performance.now(),
    accelerometer: motionFrame.accelerometer,
  });

  return Number.isFinite(intensity?.norm)
    ? intensity.norm
    : 0;
}


//-------------- Build XMM Frame -------------------
export function buildXmmFrame(motionFrame, intensityNorm) {
  return [
    motionFrame.accelerometer.x,
    motionFrame.accelerometer.y,
    motionFrame.accelerometer.z,

    motionFrame.gyroscope.x,
    motionFrame.gyroscope.y,
    motionFrame.gyroscope.z,

    motionFrame.gravity.x,
    motionFrame.gravity.y,
    motionFrame.gravity.z,

    intensityNorm,
  ];
}


//-------------- Find Best Label ------------------
export function findBestLabel(labels, scores, acceptLabel) {
  let winnerLabel = null;
  let winnerScore = -Infinity;

  labels.forEach((label, index) => {
    if (!acceptLabel(label)) {
      return;
    }

    const score = Number(scores[index]);

    if (Number.isFinite(score) && score > winnerScore) {
      winnerLabel = label;
      winnerScore = score;
    }
  });

  return winnerLabel;
}
