import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'luckydraw-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  webOrigin: (process.env.WEB_ORIGIN || 'http://localhost:5173').split(','),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:5173',
  defaultAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  isProd: process.env.NODE_ENV === 'production',
};
