export class LockManager {
  constructor(jobRepository) {
    this.jobRepository = jobRepository;
  }

  claimNext(workerId) {
    return this.jobRepository.claimNext(workerId);
  }
}
