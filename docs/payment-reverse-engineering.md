# UPPCL `/wss` SPA — payment, notification & profile request shapes

Source: static analysis of `https://consumer.uppcl.org/wss/` bundle `main.2dc555616dbad9af.js`
(1.32 MB). The three lazy chunks listed in `runtime.5e0113c0a6d77c6c.js`
(`178.888c83076f583047`, `855.1ab2704fe0f87869`, `896.c8bd18761f527994`) were downloaded and hold
nothing relevant; **all code below is in main**. No API endpoint was called. Offsets (`@123456`) are
character offsets into main.js, so you can check each quote with
`python3 -c "s=open('main…js').read();print(s[N-300:N+300])"`.

## 0. Transport (applies to every call)

- **Base URL**: `https://consumer.uppcl.org/uppclwss` (not `/wss`, which is the SPA). The env module
  `20553` @1308048 has `apibaseUrl:"https://consumer.uppcl.org/uppclwss"`. Paths are added directly,
  e.g. `/v2/InstaPayment/GetPayBillDetails`.
- **Headers** (interceptor @1313083):
  `setHeaders:{...je&&{appServiceKey:je}}` is always sent. `loginId` and
  `authorization: Bearer <token>` are added only when a bearer is stored:
  `Ye&&(j=j.clone({setHeaders:{...Te&&{loginId:Te},...Ye&&{authorization:Ye}}}))`.
  A 401 while logged in forces a logout.
- **Body encryption** (@1314700): only for `POST` to apibaseUrl with a non-FormData body:
  `j.clone({body:{_cdata:Te.getEncryptedRequest(JSON.stringify(j.body))}})`. **GET requests are not
  encrypted.** Their params go in the query string (`http.get(url,{params:S})`).
- `getConsumerDetails` (logged in) is `POST /api/getConsumerDetails` and sends the extra headers
  `x-cached`/`x-reset`. The public variant is `POST /v2/api/getConsumerDetails` @56106.
- Captcha is **client-side only**: `validateCaptcha(){return!this.isCaptchaEnabled||validateCaptcha()}`
  (a global canvas function, @~62000). No captcha token is sent to the server.
- OTP format: `regexOTP="^[0-9]{4}$"`, so OTPs are **4 digits**. Mobile numbers use `^[0-9]{10}$`,
  account numbers (kno) use `^[0-9]{10}$` and bill numbers use `^[0-9]{12}$`.

## 1. Bill payment flow (as the SPA runs it)

Components: `ti` = pay-bill-home (routes `pay_bill_home`, `pay_bill/:kno/:discom[/:ec]`,
`smart_bill_pay_home`, `pay_smp_arrear`) → `app-payment-options` (@697941) → `app-bill-desk`
(@630889) → full-page form POST to the gateway → `/wss/pgresponse?refNo=…` (`app-payment-response`).

### Step 1: fetch bill (no login)
`POST /v2/InstaPayment/GetPayBillDetails`, auth = appServiceKey only.
```js
this.getPayBillDetails({mobile:"mobile"==this.searchBy?this.mobile:void 0,
  kno:"kno"==this.searchBy?this.kNo:void 0,discomName:this.selectedDiscom})   // @663353
```
Body: `{kno:"1234567890", discomName:"DVVNL"}` or `{mobile:"98xxxxxxxx", discomName}`. The discom
must be one of `["DVVNL","MVVNL","PUVNL","PVVNL","KESCo"]`.
Deep link `pay_bill/:kno/:discom/:ec` sends `{kno,discomName}` and, on success, sets
`PayBillHomeDTO.empRefNo=ec`.

Logged-in variant: `POST /v1/Payment/GetPayBillDetails` (bearer). The body is the whole
`ConsumerDetails` object with `discomName=discom` added (@673270: `pe.discomName=pe.discom,
this.paymentService.getPayBillDetailsAuth(pe)`).

Response `{PayBillHomeDTO:{…}}`. Fields the SPA reads:
- `PayBillHomeDTO.{kno, payableAmt, totalAmount, serviceName, empRefNo, accounts[].secondaryAccountNo, paymentType, partialPayment, email, mobile, discomName, payBillDetailsDTO, serviceRequestDTO}`
- `customerDetailsDTO.{kno, name, firstName, lastName, billNo, billDate, dueDate, dueAmount, oldDueAmount, payAmtBeforeDueDt, payAmtAfterDueDt, mobileNo, phoneNo, email, discom, discomName, division, divCode, ampISP, typeOfConnection (SMPREPAID|SMPostpaid|Prepaid|…), purposeOfSupply (e.g. LMV1), supplyType, category, sanctionedLoad ("x KW"), loadInKW, lifelineAct, mothersName (reused as a "T" = temp-disconnected flag), billingAddress}`

Error mapping @664154: `ResMsg "Invalid Details"` → wrong discom; `"No Bill Exists!"`; statusCode
`PARAM_302` → account not in that discom; `BILLHOLD_303` → bill on hold.

### Step 2: choose amount → `updateConsumerInputAmount`
Payment types: `DueAmount="1", PartPayment="2", AdvancePayment="3"`. The default is `"1"`, and the
amount starts as `payableAmt`.
```js
const me={...this.billDetails.PayBillHomeDTO,paymentType:this.selectedPaymentType,
  partialPayment:this.selectedPaymentType==r.uG.PartPayment?"yes":null,
  totalAmount:this.isSmartBillRecharch?Number(this.amtToPaySMPrepaid).toString():Number(this.totalAmount).toString(),
  discomName:this.billDetails.PayBillHomeDTO.customerDetailsDTO.discomName};          // @~705500
this.fromDashboard?this.paymentService.updateConsumerInputAmountAuth(me)…:this.paymentService.updateConsumerInputAmount(me).subscribe(oe=>{…this.billDetails=oe})
```
- Guest: `POST /v2/InstaPayment/updateConsumerInputAmount`, appServiceKey only. The body is the
  **entire PayBillHomeDTO** with `paymentType`, `partialPayment`, `totalAmount` (string) and
  `discomName` overridden. **The response replaces billDetails wholesale** (same `{PayBillHomeDTO}`
  shape).
- Logged in: `POST /v1/Payment/updateConsumerInputAmount`. Only `oe.paymentDetails` is used, and it
  becomes `payBillDetailsDTO`. The client then sets `payableAmount`, `totalAmount`, `paymentType` and
  `discomName` locally.
- (Also present: `POST /v2/InstaPayment/updateConsumerInputEmail` with the PayBillHomeDTO plus
  `email` and `discomName`. The response replaces billDetails. Its caller `updateConsumerEmail()` was
  not seen being triggered: UNVERIFIED if it is used.)

### Step 3: the gateway page (`app-bill-desk`) builds the payment request
In `ngOnInit` (@630889) `payBillDetailsDTO` is **reset**:
```js
payBillDetailsDTO={paymentId:"",billDate:null,billDueDate:"",caseOrBillNo:customerDetailsDTO.billNo,
  bankId:null,empRefNo:null,serviceName:null,matchTypeCode:null}
billAmount=PayBillHomeDTO.totalAmount; payBillDetailsDTO.empRefNo=PayBillHomeDTO.empRefNo
// serviceName copied only when PayBillHomeDTO.serviceName includes "CR_" or "OTS_"
```
The user edits email and mobile. Masked values containing `*` fall back to `customerDetailsDTO`.
The user must pick a gateway: `selectedBandId` ∈ `"BILLDESK"` | `"PAYU"` (shown only if
`isPayU`, which is true in prod) | `"SBI"` (code path exists, no radio button).

`getPaymentRequest()` @636867 mutates and returns `PayBillHomeDTO`:
```js
payBillDetailsDTO.paymentId="WEB";
payBillDetailsDTO.billDate = formatDate(customerDetailsDTO.billDate,"yyyy-MM-dd")   // non-SMPREPAID only
payBillDetailsDTO.billDueDate = payBillDetailsDTO.billDueDate || customerDetailsDTO.dueDate;
payBillDetailsDTO.caseOrBillNo = paymentType=="3" ? "Advanced Payment" : caseOrBillNo;
PayBillHomeDTO.partialPayment = paymentType=="2" ? "yes" : null;
payBillDetailsDTO.bankId = selectedBandId;           // "BILLDESK"
PayBillHomeDTO.email / .mobile = user-entered (unmasked) or customerDetailsDTO values
// SMPREPAID arrear case: caseOrBillNo="AMISPWSS", serviceName="CR_SMPrepaid_Arrear",
// serviceRequestDTO={accountNumber:kno,srType:"CR_SMPrepaid_Arrear",param1:meterSerialNo,
//   param2:ampISP,charges1:billAmount,createdate:<date>}
```

### Step 4: `processPaymentRequestWithPG`
`POST /v2/InstaPayment/processPaymentRequestWithPG`. The body is the PayBillHomeDTO above.
**It is v2 in both the guest and logged-in paths**, so only appServiceKey is needed; a bearer is
attached if present. (`/v2/InstaPayment/processPaymentRequest` exists in the service but has **no
caller**.)

Response fields used: `bdRequestDTO.{message, url, key, trackId, rurl}` (@635680).

### Step 5: hand-off to BillDesk (legacy form POST, not the JS SDK)
```js
"BILLDESK"==this.selectedBandId?this.paymentService.postToBillDeskPaymentGateway(se.bdRequestDTO.message,se.bdRequestDTO.url)
postToBillDeskPaymentGateway(o,i){…T.method="POST",T.action=`${i}`;…J.name="msg",J.value=o…T.submit()}   // @67900
```
This is a hidden `<form method=POST action=bdRequestDTO.url>` with one field, `msg=bdRequestDTO.message`
(the server builds and signs the classic BillDesk PGI message). The browser leaves the SPA.
Variants:
- PayU: form fields `key, txnid=trackId, productinfo=kno, amount, email, firstname, lastname="",
  surl=furl=rurl, phone, hash=bdRequestDTO.message, udf1=division, udf2=divCode, udf3=discomName,
  udf4=ampISP`.
- SBI: fields `EncryptTrans=message, merchIdVal=key`.

**BillDesk SDK (`loadBillDeskSdk`) is not used for bill payment.** It is only called by
`registerAutoPay()` (e-mandate). That flow is gated by `enableAutoPay`, which is `!1` (false) in the
shipped env:
```js
callBilldeskSdk(me,oe,Je,it){new loadBillDeskSdk({flowConfig:{merchantId:me,mandateTokenId:oe,
  authToken:Je,childWindow:!0,returnUrl:it,retryCount:3},flowType:"emandate"})}          // @713065
```
- Its inputs come from `POST /v2/SIPayment/CreateOrder`. The body is
  `{requestPayloadDTO:{mercid, customer_refid:kno, subscription_refid:discom+kno+ddMMyy,
  subscription_desc:"BillPay", currency:"356", frequency:"mnth", amount_type:"maximum",
  amount:"2.00", start_date, end_date:+30y, recurrence_rule:"after", debit_day:"1",
  customer:{first_name,last_name,mobile,mobile_alt,email,email_alt},
  additional_info:{…}, device:{init_channel:"WEB",ip:"1.1.1.1",user_agent:"UPPCLPortal"},
  ru:returnUrl}, bdTraceid:Date.now()+kno, bdTimestamp:Date.now()}`.
- The response `Payload` is decrypted with `cryptoService.decryptHmacString`. The SPA then reads
  `mercid`, `mandate_tokenid` and `links[].headers.authorization` (this is the SDK `authToken`).
- Delete: `POST /v2/SIPayment/DeleteMandate` with
  `{requestPayloadDTO:{account_num,discom},bdTraceid,bdTimestamp}`.
- The env values here are **UAT**: `mercid:"UPPCLSIUAT"`,
  `returnUrl:"https://ptltest.uppclonline.com/wss-test/v2/SIPayment/PostCreateOrderResponse"`. The
  feature is unfinished. `registerPayU()` also hardcodes `test.payu.in`, a test key and
  `localhost:4200`.
- There is no `bdOrderId`/`flowType:"payments"` usage anywhere in the bundle.

**SDK host:** `index.html` statically includes `uat1.billdesk.com/merchant-uat/sdk/dist/…` (esm,
nomodule and css). At bootstrap main.js **also injects the production SDK**:
```js
y.src=`${I.N.billDeskSdkUrl}/billdesksdk/billdesksdk.esm.js`   // billDeskSdkUrl:"https://pay.billdesk.com/jssdk/v1/dist"  @1316091
```
So both UAT and prod SDKs load, and which `loadBillDeskSdk` global wins is load-order dependent
(UNVERIFIED). This does not matter for bill payment, which never uses the SDK.

### Step 6: return and verification
- BillDesk posts back to `bdRequestDTO.rurl`, which is server-side and comes from the step 4
  response. The backend then redirects the browser to the SPA route `pgresponse` with
  `?refNo=<trackId>` (the route is `{path:"pgresponse",component:e.p}`, and the component reads
  `activatedRoute.snapshot.queryParams.refNo`). The exact redirect URL is built server-side:
  UNVERIFIED, probably `https://consumer.uppcl.org/wss/pgresponse?refNo=…`.
  `pgLoadResponse` is the same flow for load-enhancement.
- `GET /v2/InstaPayment/getPaymentReciept?trackID=<refNo>`. It is unencrypted, sent without login,
  and works with appServiceKey only:
  `this.paymentService.getPaymentReciept({trackID:this.refNo})` (@1247347).
- Response `PaymentReciept.{paymentStatus, serviceName, accountNumber, custName, payment_amount,
  paymentDate, discomName, tran_ref_number, trackId}` plus `bytecode` (a base64 receipt PDF).
- Status enum: `SUCCESS="1", SUCCESS1="4", REJECTED="2", INITIATED="0"`.
  - `"1"` or `"4"`: success. The SPA calls `consumerService.clearCache()`, which is
    `GET /clearCache`.
  - `"0"`: "no response from BillDesk… verify … after 2-3 hours".
  - Anything else: failed.
- Later verification (logged in): `POST /v1/api/onlinePaymentStatus` with
  `{kno, startDate:"yyyy-MM-dd", endDate, typeOfConnection, discomName}`. The range is at most 3
  months (`OPS_400`). The response `OnlinePaymentStatus[]` rows have
  `{tranRefNo, paymentAmount, paymentMode, bankId, paymentDate, paymentStatus}`. The page is blocked
  for prepaid (`routesBlockedForPrepaid`). It needs login in the SPA (route guard); whether the
  server enforces a bearer is UNVERIFIED.
- Public receipt lookups (captcha is client-side):
  - `POST /v2/lastOnlinePaymentReciept` with `{kno, discomName}` → `LastOnlinePaymentReciept.{accountNo, customerName,…}`
  - `POST /v2/api/receiptOnTransactionId` with `{transactionId, discomName, accountId}` → `statusCode:"PAYMENT_RECEIPT_200"`, `Response` = base64 PDF
  - `POST /v2/api/receiptOnEncryptedTransId?pr=…`

### Smart-meter prepaid extras (typeOfConnection `SMPREPAID`)
- `POST /v2/InstaPayment/getArrearAmountStatus` with `{accountID:kno, discom}` → `data.amount`.
- `POST /v2/InstaPayment/prepaidBalanceEnquiry` with `{accountId:kno, targetSystem:ampISP, discomName}`.
  The response has `statusCode:"1"` and `prepaidBalance`, which is negative when the account is due.
- `POST /v2/Utility/getMeterData` with `{kNumber, discom, sanctionedLoad:loadInKW, connectionType}`
  → `data.meterSerialNumber`.
- Arrear view/report: `POST /v2/InstaPayment/viewArrear` with
  `{discomName, kno, reportName:"PendingArrear"|"NEFTRTGS"}`.
  Arrear lookup: `POST /v2/InstaPayment/accountArrear` with `{discomName, kno, searchOption}`.

## 2. Amount rules (all client-side; the server may enforce others, UNVERIFIED)

From `isInValidAmount()` (@~707500):
- The amount must be an integer string `^[0-9]+$` and greater than 0, with at most 7 digits
  (`"Please input the amount less than 10000000 Rs."`).
- **Due (1)**: amount ≥ payableAmt (`"Amount can not be less than Bill Due Amount"`). Overpaying is
  allowed.
- **Part (2)**: amount ≤ payableAmt, and amount ≥ `ceil(0.10*payable)` if `purposeOfSupply=="LMV1"`,
  otherwise ≥ `ceil(0.25*payable)`:
  `let it=Math.ceil(.1*Je);if("LMV1"!=this.purposeOfSupply&&(it=Math.ceil(.25*Je)),oe<it)`.
- **Advance (3)**: allowed only if payableAmt ≤ 0 (`"Please pay Bill Due Amount first"`), and must be
  a multiple of 1000 (`oe%1e3>0` → error).
- A further block (min 250/1000, temp-disconnected 25%, lifeline) sits under
  `else if("NA"==this.purposeOfSupply)`. Its inner `"25"==purposeOfSupply` check can never be true,
  so it applies only when purposeOfSupply is literally `"NA"`. It looks like dead code.
- Smart prepaid recharge: the amount must be ≥ 100 (`"Recharge Amount should be greater than 100"`).
- Smart prepaid arrear: the amount must be ≤ arrear, and ≥ 100 unless the arrear itself is < 100
  (then it must equal the arrear). `meterSerialNo` is required.
- `minimumAmtToPayInSmPostPaid = customerDetailsDTO.oldDueAmount` is displayed only.
- **Convenience fees** are text only (`chargesInstructionsArray`); no fee is computed client-side:
  - Net banking, wallet, UPI: free.
  - Cards: free up to ₹4000.
  - Debit cards other than RuPay, above ₹4000: 0.90% + GST.
  - Credit cards above ₹4000: 1.00% + GST.
- OTP before payment appears only for OTS (`applyOtp` when `serviceName` includes
  `OTS_ONETIME_`/`OTS_INSTALLMENT_`). Normal bills need no OTP.

## 3. Paperless / notification settings

### Bill on email (logged in, route `consumer-services/bill-on-email`, blocked for prepaid)
The current state is `ConsumerDetails.onlineBillingStatus=="EMAIL"` (checkbox checked).
```js
this.billingService.updateOnlineBillRegDetails({kno,discom,statusSelection:1==this.isChecked?"Email":"Postal",
  personId,mobileNo,phoneNo,email,dateOfBirth,onlineBillingStatus})     // @970936
```
- `POST /v1/billOnEmail/updateOnlineBillRegDetails`. All values come from `ConsumerDetails`
  (`getConsumerDetails`), so it needs a bearer.
- Register uses `statusSelection:"Email"`; deregister uses `"Postal"`. The bill goes to the
  **already registered** email, and this endpoint cannot change it.
- **No OTP.** Success is any 2xx; the SPA does not check a statusCode.

### WhatsApp subscription (logged in, route `consumer-services/whatsApp-subscription`)
The state is subscribed if `ConsumerDetails.whatsAppNo` is not `""`/`null`/`"NA"`.
**OTP is required (UI-gated)**: the Subscribe button renders only when `isOtpVerified`.
1. `POST /v2/api/sendOTP` with `{discomName:consumerData.discom, kno}`. The OTP goes to the
   registered mobile.
2. `POST /v2/api/verifyMobileOTP` with `{kno, mobileNo:ConsumerDetails.mobileNo, otp, discomName}`.
   Success is `statusCode:"VRFY_OTP_200"`.
3. Subscribe: `POST /v2/WAP/addWAPSubscription` with `{kno, discomName, mobileNo}`. `mobileNo` is the
   existing `whatsAppNo`, or the registered mobile if there is none. Success is
   `statusCode:"WAPPS_SUBS_200"` and the SPA shows `statusMsg`. Errors: `WAPPS_SUBS_301/302/417`.
4. Unsubscribe: `POST /v2/WAP/deleteWhatsappNumber` with the same body. Success is
   `statusCode:"WD_200"`.

### Change mobile / secondary / email / WhatsApp: public flow (route `update_contact_details`, `app-update-mobile-no` @399085)
The flow works without login and uses appServiceKey. If the user is logged in, kno and discom are
prefilled.

Step 0, look up the account:
- `POST /v2/api/GetDiscom` with `{kno, discomName}`.
- Then `POST /v2/api/getConsumerDetails` with `{kno, discomName}`. It returns
  `mobileNo, phoneNo (secondary), email, whatsAppNo ("NA" = none), personId`.

Step 1, prove ownership:
- Option A, the user has the old mobile:
  - `POST /v2/api/sendOTP` with `{discomName, kno}` (sent to the registered mobile).
  - `POST /v2/api/verifyMobileOTP` with `{kno, mobileNo:<registered>, otp, discomName}`.
- Option B, no access: KBA using the last bill number, checked by `POST /v2/api/billValidate` with
  `{kno, discomName, billNo}`, or the meter number (not checked server-side in this step). This is
  followed by an Aadhaar dialog (`/v2/generateOtp` with `{aadhaarno}` and `/v2/doKyc`; the full
  shapes were not traced, UNVERIFIED).

Step 2, depends on the option selected:

| Change | Send OTP (to the NEW value) | Verify | Commit | Success code |
|---|---|---|---|---|
| Primary mobile | `POST /v2/api/sendNewOTP` `{discomName,kno,mobileNo:new}` | `POST /v2/api/verifyMobileOTP` `{kno,mobileNo:new,otp,discomName}` | `POST /v2/api/updateMobNo` `{kno,discomName,newMobileNo}` | `UPD_MOB_200` |
| Secondary (`phoneNo`) | sendNewOTP `{…,mobileNo:newSecondary}` | verifyMobileOTP | `POST /v2/api/updateSecondaryNo` `{kno,discomName,phoneNo}` | `UPD_SECMOB_200` |
| WhatsApp | sendNewOTP `{…,mobileNo:newWA}` | verifyMobileOTP | `POST /v2/WAP/addWAPSubscription` `{kno,discomName,mobileNo:newWA}` | `WAPPS_SUBS_200` |
| Email | `POST /v2/Utility/sendEmailOTP` `{kno,discom,email:new}` | `POST /v2/Utility/validateEmailOTP` `{discom,email:new,otp}` | `POST /v2/Utility/updateEmail` `{accountID:kno,discom,personId,oldEmail,newEmail}` | `UE_200` |

Snippets: `updateMobNo(){let m={kno:this.kno,discomName:this.discomName,newMobileNo:this.newMobileNumber}`,
`updateEmailId(){let m={accountID:this.kno,discom:this.discomName,personId:this.personId,oldEmail:this.resEmailId,newEmail:this.newEmailId}`.
Note: the email and discom keys are `discom` (not `discomName`) for the Utility email endpoints.
Some verify callbacks use `(p.statusCode="VRFY_OTP_200")`, an assignment bug, so the SPA proceeds on
any 2xx from verify.

Alternate WhatsApp-only page (`update_whatsApp_no`, `app-update-whats-app-no` @480020):
1. KBA with `billValidate`.
2. `POST /v2/api/sendOTP` `{discomName,kno}` (to the registered mobile).
3. `verifyMobileOTP` `{kno,mobileNo:newWhatsAppNo,otp,discomName}`.
4. `POST /v2/WAP/updateWhatsappNumber` `{kno,discomName,whatsAppNo}`. Success is `WU_200`.

Also present: `/v2/api/updateMobNo` via `app-udpate-mobile-number-using-aadhar` (route
`update_mobile_using_aadhaar`), and `POST /v2/api/registerUser` aliased as `updateMobileNo`. Their
shapes were not traced (UNVERIFIED).

### Contact verification (route `verify-profile`, `app-verify-mobile` @506340)
- Status: `POST /v2/Utility/getContactVerificationStatus` with `{accountId:kno, discomName}`. It
  returns `statusCode:"VRF_200_OK"` and `mobile`/`email`/`whatsApp` flags, where `"1"` means
  verified.
- Mobile:
  - `sendOTP {discomName,kno}`
  - then `verifyMobileOTP {kno,mobileNo,otp,discomName}`
  - then `POST /v2/Utility/contactVerification` with
    `{accountId, mobile, moblileVerfiedDate:"yyyy-MM-dd", discomName}` (the typo is in the source)
- WhatsApp:
  - `POST /v2/api/sendWhatsAppOTP {discomName,kno}`
  - then verifyMobileOTP with `mobileNo:whatsAppNo`
  - then contactVerification with `{accountId, whatsAppNumberVerfiedDate, whatsAppNumber, discomName}`
- Email:
  - `sendEmailOTP {kno,discom,email}`
  - then `validateEmailOTP {kno,discom,email,otp}`, which must return `VRFY_OTP_200`
  - then contactVerification with `{accountId, email, discomName, emailVerfiedDate}`
- contactVerification success is `statusCode:"000"`.

### OTP endpoints summary
| Endpoint | Body | Notes |
|---|---|---|
| `POST /v2/api/sendOTP` | `{discomName, kno}` | OTP to the registered mobile. Success msg `SND_OTP_200`. Limit error `SEND_OTP_AL_304` (24 h lockout). |
| `POST /v2/api/sendNewOTP` | `{discomName, kno, mobileNo}` | OTP to an arbitrary new number |
| `POST /v2/api/verifyMobileOTP` | `{kno, mobileNo, otp, discomName}` | `VRFY_OTP_200`. Errors: `VRFY_OTP_302` wrong, `VRFY_OTP_304` expired |
| `POST /v2/api/verifyOTP` | used by registration / account validate | not traced |
| `POST /v2/api/sendWhatsAppOTP` | `{discomName, kno}` | OTP via WhatsApp |
| `POST /v2/Utility/sendEmailOTP` / `validateEmailOTP` | `{kno,discom,email}` / `{discom,email,otp}` (+kno in verify-profile) | email OTP |
| `POST /v2/generateOtp` | `{aadhaarno}` | Aadhaar eKYC OTP, `statusMsg:"SUCCESS"` |

The resend timer is `resendInSeconds:300`.

## 4. Other profile/settings endpoints in the bundle
- **Update profile** (logged in, `consumer-services/update-profile`):
  - `POST /v1/api/getSecurityQuestion` with `{kno, discomName}` → `{securityQuestion, securityAnswer}`.
  - `POST /v1/api/updateProfile` with `{kno, discomName, phoneNumber, email, whatsAppNo, mobileNo,
    secretQuestion, secretAnswer, personId}`.
  - In the form, phone, mobile, email, WhatsApp and address are **disabled** (read-only). Only the
    secret question and answer are editable, so contact changes go through the OTP flows above.
    There is no OTP here.
- **Secondary accounts (linked KNOs)**:
  - `POST /v2/api/getSecondaryAccount` with `{primaryAccount, discom}` → `accounts[{secondaryAccountNo, secondaryDiscom}]`. The UI caps this at 10 per discom. `GETACC_300` means none.
  - Add: `POST /v2/api/sendOTP` `{discomName:secDiscom, kno:secondaryKno}` (OTP to the *secondary* account's mobile), then `verifyMobileOTP`, then `POST /v2/api/addSecondaryAccount` `{primaryAccount, secondaryAccount, discom, billNo (12-digit, of the secondary), secondaryAccountDiscom}`. Error: `ADDACC_EX_417`.
  - Delete: `POST /v2/api/deleteSecondaryAccount` `{primaryAccount, secondaryAccount, discom, secondaryAccountDiscom}`. Error: `DELACC_NE_417`.
- **PAN**: `POST /v1/api/getPanCard`, `POST /v1/api/updatePanCard` (`updatePan`). Shapes not traced.
- **Password**: `POST /v1/api/checkOldPassword`, `POST /v1/api/updatePassword`.
- **Language**: client-only (Google Translate `doGTranslate`, `window.currentLanguage`,
  i18n json under `./assets/i18n/`). **No server-side language preference.**
- **SMS alerts**: route `sms-service` is a static info page (`class v{ngOnInit(){window.scrollTo(0,0)}}`).
  There is **no SMS subscription API**.
- Other: `POST /v2/api/knowYourAccount`, `POST /v1/billSummary/getBillingSummary`
  `{kno,discomName,fromDate,toDate}`, `POST /v2/Utility/getPageMarConf`
  `{date:"YYYY-MM-dd HH:mm:ss",pageName:"LogIn"}` (maintenance banner, `PAGE_MSG_200`),
  `POST /v2/Utility/updateSMPostpaid`.

## October 2026: `trackId` is null for BillDesk

`processPaymentRequestWithPG` now answers `bdRequestDTO = {url, message, trackId: null, key: null, rurl: null,
paymentMode: null}`. UPPCL's own site never reads `trackId` for BillDesk (only for PayU), so nothing broke for
them; the app required it and refused every payment ("bill portal HTTP 502", which was our own error, not
UPPCL's). The payment reference now comes from BillDesk's return URL (`?refNo=`) as before, with a fallback
to BillDesk's order id: field 2 of the pipe-separated `message` (`shared/payment.ts` `paymentRef`).
Verified on a device: the BillDesk page opens for UPPCL with the amount; the payment itself wasn't completed.
