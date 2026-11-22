import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  dotenv.config({ quiet: true });
}
