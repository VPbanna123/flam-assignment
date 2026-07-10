export class Job {
  constructor(row) {
    Object.assign(this, row);
  }

  toJSON() {
    return { ...this };
  }
}
