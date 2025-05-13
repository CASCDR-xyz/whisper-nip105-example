const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next))
    .catch(err => {
      console.error("Async handler caught error:", err);
      
      // If response has already been sent, don't attempt to send another
      if (res.headersSent) {
        console.error("Headers already sent, cannot send error response");
        return next(err);
      }
      
      try {
        // Try to send a safe error response
        const statusCode = err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        
        // Only include stack trace in development
        const error = {
          success: false,
          error: message,
          ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        };
        
        return res.status(statusCode).json(error);
      } catch (responseError) {
        console.error("Error sending error response:", responseError);
        return next(err);
      }
    });
};

module.exports = asyncHandler;