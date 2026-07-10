import { Worker } from './Worker.js';

export class WorkerManager {
  constructor(workerFactory) {
    this.workerFactory = workerFactory;
    this.workers = [];
  }

  async start(count = 1) {
    this.workers = Array.from({ length: count }, () => this.workerFactory());

    const stopAll = () => {
      for (const worker of this.workers) {
        worker.requestStop();
      }
    };

    process.once('SIGINT', stopAll);
    process.once('SIGTERM', stopAll);

    await Promise.all(this.workers.map((worker) => worker.start()));
  }
}
