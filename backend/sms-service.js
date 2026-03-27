const axios = require('axios');

/**
 * Send OTP via SMS to a mobile number using Fast2SMS
 * Fast2SMS is Indian SMS service - no credit card needed for free tier
 * Get free API key from: https://www.fast2sms.com
 * 
 * @param {string} phoneNumber - 10 digit mobile number
 * @param {string} otp - OTP code
 * @returns {Promise<boolean>} - true if sent successfully, false otherwise
 */
async function sendOTP(phoneNumber, otp) {
  // Development mode: log OTP without sending
  if (!process.env.FAST2SMS_API_KEY) {
    console.log(`📱 [SMS MODE: DEV] OTP for +91${phoneNumber}: ${otp}`);
    console.log(`   💡 To send real SMS, add FAST2SMS_API_KEY to .env`);
    console.log(`      Get free API key: https://www.fast2sms.com`);
    return true;
  }

  try {
    const message = `Your Grocery Shop OTP is: ${otp}. Valid for 5 minutes. Do not share with anyone.`;
    
    const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
      params: {
        authorization: process.env.FAST2SMS_API_KEY,
        message: message,
        numbers: phoneNumber,
        sender_id: process.env.FAST2SMS_SENDER_ID || 'GSHOP',
      },
      timeout: 5000,
    });

    if (response.data.return === true) {
      console.log(`✅ SMS sent successfully to +91${phoneNumber}`);
      return true;
    } else {
      console.error(`❌ SMS send failed:`, response.data.message);
      return false;
    }
  } catch (error) {
    console.error(`❌ SMS send error:`, error.message);
    // In dev mode, we don't block signup if SMS fails
    if (!process.env.FAST2SMS_API_KEY) {
      return true;
    }
    return false;
  }
}

module.exports = { sendOTP };
