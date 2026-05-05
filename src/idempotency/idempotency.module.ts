import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_REPOSITORY } from './idempotency.repository';
import { InMemoryIdempotencyRepository } from './idempotency.repository.in-memory';

@Module({
  providers: [
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useClass: InMemoryIdempotencyRepository,
    },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule {}
