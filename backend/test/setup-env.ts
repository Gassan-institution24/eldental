// Test environment. Real values are never needed: Mongo is in-memory and Redis is not used.
process.env.NODE_ENV = 'test';
process.env.API_PUBLIC_URL = 'http://localhost:4000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.MONGODB_URI = process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:1/unused';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012345678';
process.env.FIELD_ENCRYPTION_KEY = '0'.repeat(63) + '1';
process.env.BCRYPT_COST = '4';
process.env.SEED_SUPERADMIN_EMAIL = 'root@test.local';
process.env.SEED_SUPERADMIN_PASSWORD = 'RootPassword123';
