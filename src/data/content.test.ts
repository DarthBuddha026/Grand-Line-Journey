import { describe, expect, it } from 'vitest';
import { validateContent } from './index';

describe('content data', () => {
  it('has no broken references or wrong level counts', () => {
    expect(validateContent()).toEqual([]);
  });
});
