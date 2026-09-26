/* Runs puzzle generation and hint searches off the main thread. */
importScripts('core.js');
self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  try {
    self.postMessage({ id, result: SortCore.tasks[type](payload) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
