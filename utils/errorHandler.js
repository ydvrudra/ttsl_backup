// utils/errorHandler.js

// ✅ ERROR TYPES
const ErrorTypes = {
    // VALIDATION ERRORS (User input issues)
    VALIDATION: {
        NO_PACKAGES: 'NO_PACKAGES',
        NO_VEHICLES: 'NO_VEHICLES',
        RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
        INVALID_INPUT: 'INVALID_INPUT'
    },

     PACKAGE_VALIDATION: {
        OVERSIZED_PACKAGE: 'OVERSIZED_PACKAGE',
        INVALID_DIMENSIONS: 'INVALID_DIMENSIONS'
    },
    
    // DATABASE ERRORS
    DATABASE: {
        CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
        QUERY_FAILED: 'DB_QUERY_FAILED'
    },
    
    // API/LOGIC ERRORS
    API: {
        TIMEOUT: 'API_TIMEOUT',
        ALLOCATION_FAILED: 'ALLOCATION_FAILED'
    },
    
    // SYSTEM ERRORS
    SYSTEM: {
        UNKNOWN_ERROR: 'UNKNOWN_ERROR'
    }
};

// ✅ USER-FRIENDLY MESSAGES
const ErrorMessages = {
    // VALIDATION MESSAGES
    'OVERSIZED_PACKAGE': {
        userMessage: '⚠️ Some packages are too large for available trucks. Please check dimensions.',
        httpCode: 400
    },
    'INVALID_DIMENSIONS': {
        userMessage: '⚠️ Some packages have invalid dimensions (zero or negative values).',
        httpCode: 400
    },
    
    'NO_PACKAGES': {
        userMessage: '❌ Please add at least one package to calculate truck requirements.',
        httpCode: 400
    },
    'NO_VEHICLES': {
        userMessage: '❌ No truck types configured in the system. Contact administrator.',
        httpCode: 500
    },
    'RECORD_NOT_FOUND': {
        userMessage: '❌ Form data not found. Please save the form again.',
        httpCode: 404
    },
    'INVALID_INPUT': {
        userMessage: '❌ Invalid input provided. Please check your data.',
        httpCode: 400
    },
    
    // DATABASE MESSAGES
    'DB_CONNECTION_FAILED': {
        userMessage: '⚠️ System is temporarily unavailable. Please try again in 2 minutes.',
        httpCode: 503
    },
    'DB_QUERY_FAILED': {
        userMessage: '⚠️ Database operation failed. Please try again.',
        httpCode: 500
    },
    
    // API MESSAGES
    'API_TIMEOUT': {
        userMessage: '⏳ Truck calculation is taking longer than expected. Please try again.',
        httpCode: 408
    },
    'ALLOCATION_FAILED': {
        userMessage: '⚠️ Could not allocate trucks for your packages. Please check package dimensions.',
        httpCode: 500
    },
    
    // DEFAULT
    'UNKNOWN_ERROR': {
        userMessage: '⚠️ An unexpected error occurred. Our team has been notified.',
        httpCode: 500
    }
};

// ✅ CUSTOM ERROR CLASS
class AppError extends Error {
    constructor(errorCode, technicalDetails = '') {
        // Get error info or use default
        const errorInfo = ErrorMessages[errorCode] || ErrorMessages.UNKNOWN_ERROR;
        
        // Call parent constructor
        super(errorInfo.userMessage);
        
        // Custom properties
        this.errorCode = errorCode;
        this.userMessage = errorInfo.userMessage;
        this.httpCode = errorInfo.httpCode;
        this.technicalDetails = technicalDetails;
        this.timestamp = new Date().toISOString();
        
        // Proper stack trace
        Error.captureStackTrace(this, this.constructor);
    }
    
    // Convert to JSON for response
    toJSON() {
        return {
            status: 'error',
            errorCode: this.errorCode,
            userMessage: this.userMessage,
            timestamp: this.timestamp
        };
    }
}

// ✅ FUNCTION TO SEND ERROR RESPONSE
function sendErrorResponse(res, error) {
    // Log the error
    console.error(`🔴 [${error.errorCode}] ${error.message}`);
    if (error.technicalDetails) {
        console.error(`   Technical: ${error.technicalDetails}`);
    }
    
    // Send response
    return res.status(error.httpCode || 500).json(error.toJSON());
}

// ✅ EXPORT EVERYTHING
module.exports = {
    ErrorTypes,
    ErrorMessages,
    AppError,
    sendErrorResponse
};