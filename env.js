export function validateEnv() {
  const required = ["PAYSTACK_SECRET", "FIREBASE_ADMIN_B64"];

  required.forEach((key) => {
    if (!process.env[key]) {
      throw new Error("Missing environment variable: " + key);
    }
  });
}
