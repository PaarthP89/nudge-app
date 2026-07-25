function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  console.error('[errorHandler]', status, message, err.errors || err.response?.data || '');
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
