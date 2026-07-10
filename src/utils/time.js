export function nowIso() {
  return new Date().toISOString();
}

export function epochMs() {
  return Date.now();
}

export function secondsFromNow(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
