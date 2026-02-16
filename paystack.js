import axios from "axios";

export async function ESCROW_PAYMENT(email, amount, reference) {
  const response = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      email,
      amount: amount * 100,
      reference
    },
    {
      headers: {
        Authorization: "Bearer " + process.env.PAYSTACK_SECRET
      }
    }
  );

  return response.data.data.authorization_url;
}
