const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const app = express();
const port = 3000;
const {
  TonClient,
  WalletContractV4,
  internal,
  toNano,
  SendMode,
  Address,
} = require("@ton/ton");
const { mnemonicToPrivateKey } = require("@ton/crypto");
// Connect to MongoDB
mongoose.connect("mongodb://127.0.0.1/cta", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB");
});
// models
const transactionSchema = new mongoose.Schema({
  hash: { type: String },
  lt: { type: String },
  account: {
    address: { type: String },
    is_scam: { type: Boolean },
    is_wallet: { type: Boolean },
  },
  utime: { type: String },
  total_fees: { type: String },
  transaction_type: { type: String },
  in_msg: {
    msg_type: { type: String },
    created_lt: { type: String },
    ihr_disabled: { type: Boolean },
    bounce: { type: Boolean },
    bounced: { type: Boolean },
    value: { type: String },
    fwd_fee: { type: String },
    ihr_fee: { type: String },
    destination: {
      address: { type: String },
      is_scam: { type: Boolean },
      is_wallet: { type: Boolean },
    },
    source: {
      address: { type: String },
      is_scam: { type: Boolean },
      is_wallet: { type: Boolean },
    },
    import_fee: { type: String },
    created_at: { type: String },
  },
  block: { type: String },
  credit_phase: {
    fees_collected: { type: String },
    credit: { type: String },
  },
  out_msgs: [
    {
      msg_type: { type: String },
      created_lt: { type: String },
      ihr_disabled: { type: Boolean },
      bounce: { type: Boolean },
      bounced: { type: Boolean },
      value: { type: String },
      fwd_fee: { type: String },
      ihr_fee: { type: String },
      destination: {
        address: { type: String },
        is_scam: { type: Boolean },
        is_wallet: { type: Boolean },
      },
      source: {
        address: { type: String },
        is_scam: { type: Boolean },
        is_wallet: { type: Boolean },
      },
      import_fee: { type: String },
      created_at: { type: String },
    },
  ],
});
const Transaction = mongoose.model("Transaction", transactionSchema);
const accountSchema = new mongoose.Schema({
  WalletAddress: {
    type: String,
  },
  awards: [
    {
      awardId: mongoose.Schema.Types.ObjectId,
      // awardName: String,
      claimed: { type: Boolean, default: false },
      create_at: Date,
    },
  ],
});
const Account = mongoose.model("Account", accountSchema);
const awardSchema = new mongoose.Schema({
  totalFee: { type: String },
  awardfee: { type: String },
  receivingFee: { type: String}
});
const Award = mongoose.model("Award", awardSchema);
// const statusAwardSchema = new mongoose.Schema({
//   AddressWallet: { type: String },
//   Award: { type: String },
//   status: { type: String },
//   fee: { type: String },
// });
// const StatusAward = mongoose.model("StatusAward", statusAwardSchema);
// app.get('/add-account', (req, res) => {
//     const newAccount = new Account({
//       WalletAddress: '0QBnRzN8w7CcLLneIZ48mFjmTxeAUDmIjV_y3upAOolxUojU'
//     });

//     newAccount.save()
//       .then(() => res.send('New account added successfully'))
//       .catch(err => res.status(500).send('Error adding account: ' + err.message));
// });
// Route to fetch transactions
//Chuyển thời gian của utime trong transaction 
function convertToUnixTimestamp(dateTime) {
  // Create a Date object from the input date and time
  const date = new Date(dateTime);

  // Get the Unix timestamp by dividing the milliseconds since the epoch by 1000
  const unixTimestamp = Math.floor(date.getTime() / 1000);

  return unixTimestamp;
}
//lấy các transaction của account trong hệ thống
app.get("/transactions", async (req, res) => {
  try {
    // Query all accounts in the database
    const accounts = await Account.find();
    console.log("Accounts fetched:", accounts.length);
    if (!accounts || accounts.length === 0) {
      return res.status(404).send("No accounts found");
    }

    // Prepare to fetch transactions for all accounts
    const transactionsPromises = accounts.map((account) => {
      const apiUrl = `https://testnet.tonapi.io/v2/blockchain/accounts/${account.WalletAddress}/transactions`;

      return axios
        .get(apiUrl)
        .then(async (response) => {
          //set thời gian bắt đầu và kết thúc khi get transaction
          const a = convertToUnixTimestamp("2024-05-02T00:00:00");
          const b = convertToUnixTimestamp("2024-05-02T23:59:00");
          // Filter transactions based on `utime`
          const targetStartTime = a;
          const targetEndTime = b;

          const filteredTransactions = response.data.transactions.filter(
            (transaction) => {
              const utime = transaction.utime;
              return utime >= targetStartTime && utime <= targetEndTime;
            }
          );
          //   filteredTransactions.forEach(async transaction => {
          //     const newTransaction = new Transaction(transaction);
          //     await newTransaction.save();
          // });
          // Save filtered transactions to the database, avoiding duplicates
          for (const transaction of filteredTransactions) {
            const existingTransaction = await Transaction.findOne({
              hash: transaction.hash,
            });
            if (!existingTransaction) {
              const newTransaction = new Transaction(transaction);
              await newTransaction.save();
            }
          }
          // Calculate the total fee for filtered transactions
          const totalFee = filteredTransactions.reduce((sum, transaction) => {
            return sum + (transaction.total_fees || 0);
          }, 0);
          // Retrieve potential awards based on totalFee
          const awards = await Award.find();
          let highestAward = null;
          awards.forEach((award) => {
            if (parseInt(totalFee) >= parseInt(award.totalFee)) {
              if (
                !highestAward ||
                parseInt(award.totalFee) > parseInt(highestAward.totalFee)
              ) {
                highestAward = award;
              }
            }
          });

          if (highestAward) {
            console.log(`Account ${account.WalletAddress} has earned an award`);
            console.log(highestAward);
            await Account.updateOne(
              { WalletAddress: account.WalletAddress },
              {
                $push: {
                  awards: {
                    awardId: highestAward._id,
                    // awardName: highestAward.awardfee,
                    claimed: false,
                    create_at: new Date(),
                  },
                },
              }
            );
          }
          return {
            walletAddress: account.WalletAddress,
            totalFee: totalFee,
            transactions: {
              transactions: filteredTransactions,
            },
          };
        })
        .catch((error) => ({
          walletAddress: account.WalletAddress,
          error: error.response ? error.response.statusText : error.message,
        }));
    });

    // Execute all HTTP requests concurrently using Promise.allSettled
    const results = await Promise.allSettled(transactionsPromises);

    // Filter the results to only include fulfilled promises
    const filteredResults = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    // Return the filtered results
    res.json(filteredResults);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).send("Error processing request: " + error.message);
  }
});
///////////////////////////Transfer///////////////////////////////////////////////
const client = new TonClient({
  endpoint:
    "https://testnet.toncenter.com/api/v2/jsonRPC?api_key=12ef1fc91b0d4ee237475fed09efc66af909d83f72376c7c3c42bc9170847ecb",
});
// Define a function for creating a transfer on the TON blockchain
async function createTransfer(address, amount) {
  let mnemonics =
    "sound effort chicken detail prison liberty radio intact surprise rely worth elite bone journey sketch save uncle remain switch hello labor item swallow crew".split(
      " "
    );
  let keyPair = await mnemonicToPrivateKey(mnemonics);
  let wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  let contract = client.open(wallet);
  let seqno = await contract.getSeqno();

  const internal_msg = internal({
    to: address,
    bounce: Address.parseFriendly(address).isBounceable,
    value: toNano(amount),
    init: undefined,
  });

  const transfer = contract.createTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.SEND_VALUE_ONLY,
    messages: [internal_msg],
  });

  await contract.send(transfer);
  return internal_msg.body.hash().toString("hex");
}
// SEND AWARD //
const TonWeb = require("tonweb");
const { JettonWallet } = TonWeb.token.jetton;

async function sendAward(destinationAddress, amount) {
  console.log(amount);
  const endpoint = "https://testnet.toncenter.com/api/v2/jsonRPC";
  const apiKey =
    "a69144368c0811648a36446710aee333bf2b616ac46f1d325b841008fb346b1a"; 

  // Initialize TonWeb with HTTP provider
  const tonweb = new TonWeb(new TonWeb.HttpProvider(endpoint, { apiKey }));

  // Initialize wallet using mnemonics to derive the keyPair
  const mnemonics =
    "birth gather mechanic crouch female cake warrior year satisfy midnight foam chef ahead bus wasp where valve fly artist heavy smart pause brave mail".split(
      " "
    );
  let keyPair = await mnemonicToPrivateKey(mnemonics); 
  const WalletClass = tonweb.wallet.all["v4R2"];
  const wallet = new WalletClass(tonweb.wallet.provider, {
    publicKey: keyPair.publicKey,
  });
  const seqno = await wallet.methods.seqno().call();

  const jettonWallet = new JettonWallet(tonweb.provider, {
    address: 'kQBLbEEoNfVqNBzxA0h7k4co1JeHXfGxZEeLTuEuEH3kU2SB'
  });
  const jettonWalletDes = new JettonWallet(tonweb.provider, {
    address: destinationAddress
  });
  try {
    const transferResult = await wallet.methods
      .transfer({
        secretKey: keyPair.secretKey,
        toAddress: jettonWallet.address,
        amount: TonWeb.utils.toNano('0.05'), // Convert amount to string
        seqno: seqno,
        payload: await jettonWallet.createTransferBody({
          tokenAmount: amount, // Jetton amount (in basic indivisible units)
          toAddress: new TonWeb.utils.Address(jettonWalletDes.address.toString()), // recepient user's wallet address (not Jetton wallet)
          forwardAmount: TonWeb.utils.toNano('0.01'), // some amount of TONs to invoke Transfer notification message
          forwardPayload: new TextEncoder().encode('gift'), // text comment for Transfer notification message
          responseAddress: new TonWeb.utils.Address(jettonWalletDes.address.toString()) // return the TONs after deducting commissions back to the sender's wallet address
        }),
        sendMode: 3,
      }).send()

    return transferResult;
  } catch (error) {
    console.error("Failed to send Jettons:", error);
    throw new Error("Failed to send Jettons");
  }
}

app.get("/sendtoken", async (req, res) => {
  const address = "0QBnRzN8w7CcLLneIZ48mFjmTxeAUDmIjV_y3upAOolxUojU";
  // const amountToSend = 1;
  // const amount = amountToSend * Math.pow(10, 9);;
  const amount = 500
  // const tokenAddress = "kQBLbEEoNfVqNBzxA0h7k4co1JeHXfGxZEeLTuEuEH3kU2SB";
  if (!address || !amount) {
    return res.status(400).json({ error: "Address and amount are required." });
  }

  try {
    const result = await sendAward(address, amount);
    if (result) {
      res.status(200).send("Tokens successfully sent.");
    } else {
      res.status(500).send("Failed to send tokens.");
    }
  } catch (error) {
    res.status(500).send(error.message);
  }
});
////////////////////////////////////////////////////////////
app.get("/transfer_claim/:address/:amount", async (req, res) => {
  try {
    const { address } = req.params;
    // const amount = 0.02;
    const { amount } = req.params;
    const transactionHash = await createTransfer(address, amount);
    // nếu createTransfer thành công => send AL token and update claimed: true
    res.send(
      `Transfer initiated successfully, transaction hash: ${transactionHash}`
    );
  } catch (error) {
    res.status(500).send(`Error initiating transfer: ${error.message}`);
  }
});
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
