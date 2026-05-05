import { Controller, Get } from '@nestjs/common';
import {
  ReconciliationResponse,
  toReconciliationResponse,
} from './reconciliation.mapper';
import { ReconciliationService } from './reconciliation.service';

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get()
  reconcile(): ReconciliationResponse {
    return toReconciliationResponse(this.service.reconcile());
  }
}
