export class LockManager {
  constructor(jobRepository) {
    this.jobRepository = jobRepository;
  }

  claimNext(workerId, options) {
    return this.jobRepository.claimNext(workerId, options);
  }
}
