import type { OperationRecord, OperationSink } from '../../src/index.js';

export class InMemoryOperationSink implements OperationSink {
  readonly records: OperationRecord[] = [];

  async append(record: OperationRecord): Promise<void> {
    this.records.push(record);
  }
}
