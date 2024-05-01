const authMiddleware = require('../middleware/auth');
const dotenv = require('dotenv');

describe('auth middleware', () => {
  let req, res, next;

  //read in env before all
  beforeAll(() => {
    // Load environment variables from .env file
    dotenv.config();
  });

  beforeEach(() => {
    req = {
      headers: {},
      params: {},
      ip: 'mockIPAddress',
      method: 'GET',
      body: {},
    };
    res = {};
    next = jest.fn();
  });

  const throwError = () => {
    throw new Error('Test error');
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should set authAllowed and authCategory to true and 1 if valid preimage', async () => {
    req.headers.authorization = `:${process.env.TEST_PREIMAGE}`;
    req.params.payment_hash = process.env.TEST_PAYMENT_HASH;

    await authMiddleware(req, res, next);

    expect(req.body.authAllowed).toBe(true);
    expect(req.body.authCategory).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('should set authAllowed and authCategory to true and 0 if valid HMAC', async () => {
    req.headers['x-hmac-signature'] = process.env.TEST_HMAC;
    req.headers['x-timestamp'] = process.env.TEST_TIMESTAMP;

    await authMiddleware(req, res, next);

    expect(req.body.authAllowed).toBe(true);
    expect(req.body.authCategory).toBe(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('should set authAllowed and authCategory based on user eligibility', async () => {
    req.headers.authorization = `Bearer ${process.env.TEST_TOKEN}`;
    req.params.service = 'GPT';

    await authMiddleware(req, res, next);

    expect(req.body.authAllowed).toBe(true);
    expect(req.body.authCategory).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('should set authAllowed and authCategory to false and 2 if none of the above checks pass', async () => {
    await authMiddleware(req, res, next);

    expect(req.body.authAllowed).toBe(false);
    expect(req.body.authCategory).toBe(2);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('should handle errors and set authAllowed and authCategory to false and 2', async () => {

    try {
      await authMiddleware(req, res, throwError);
    } catch (error) {
        // Do nothing, since we expect an error to be thrown
    }

    expect(req.body.authAllowed).toBe(false);
    expect(req.body.authCategory).toBe(2);
  });
});
