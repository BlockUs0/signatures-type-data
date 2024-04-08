import { ethers } from 'ethers';
import { getGaslessTxToSign } from './gelato';
export const MAX_INT = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
export const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const ERC20_PERMIT_TYPE = {
    Permit: [
        {
            name: 'owner',
            type: 'address',
        },
        {
            name: 'spender',
            type: 'address',
        },
        {
            name: 'value',
            type: 'uint256',
        },
        {
            name: 'nonce',
            type: 'uint256',
        },
        {
            name: 'deadline',
            type: 'uint256',
        },
    ],
};
const ERC20_PERMIT_ABI_INTERFACE = [
    'function EIP712_VERSION() view returns (string)',
    'function nonces(address) view returns (uint256)',
    'function name() view returns (string)',
];
export const getERC2612PermitTypeData = async (provider, token, owner, spender, amount, deadline) => {
    const tokenAddress = token.verifyingContract || token;
    const contract = new ethers.Contract(tokenAddress, ERC20_PERMIT_ABI_INTERFACE, provider);
    const [nonce, name, chainId] = await Promise.all([
        contract.nonces(owner),
        contract.name(),
        137,
    ]);
    let version;
    try {
        version = await contract.EIP712_VERSION();
    }
    catch (error) {
        // DEV: Polygon USDC requires version 2 for EIP712_VERSION 
        // If using a custom token please make sure it supports permit and set the appropriate version number 
        if (tokenAddress === POLYGON_USDC) {
            version = '2';
        }
        else {
            version = '1';
        }
    }
    const types = ERC20_PERMIT_TYPE;
    const value = {
        owner,
        spender,
        value: amount,
        nonce,
        deadline,
    };
    const domain = {
        name,
        version,
        chainId,
        verifyingContract: tokenAddress,
    };
    const erc20PermitToSign = {
        domain,
        types,
        value,
    };
    return erc20PermitToSign;
};
export async function getSignERC20Permit(buyerAddress, paymentIntentResponse, provider) {
    const contractAddress = paymentIntentResponse.contractAddress;
    const deadline = paymentIntentResponse.parameters['deadline'];
    const tokenAddress = paymentIntentResponse.parameters['paymentTokenAddress'];
    const amount = paymentIntentResponse.parameters['totalPrice'];
    if (!amount)
        throw new Error("No Amount set");
    const typeData = await getERC2612PermitTypeData(provider, tokenAddress, buyerAddress, contractAddress, amount, deadline);
    const permitType = { Permit: typeData.types.Permit };
    return { domain: typeData.domain, types: permitType, value: typeData.value };
}
export async function buildPaymentTransaction(permitSignature, paymentIntentResponse, provider) {
    const contractAddress = paymentIntentResponse.contractAddress;
    const functionName = paymentIntentResponse.functionName;
    const func = paymentIntentResponse.functionSignature;
    const chain = paymentIntentResponse.chain;
    const chainId = chainInfo[chain].chainId;
    const splitPermitSignature = ethers.utils.splitSignature(permitSignature);
    const permitTransactionParams = [
        splitPermitSignature.v,
        splitPermitSignature.r,
        splitPermitSignature.s,
    ];
    const orderPropertiesToExtract = [
        'paymentTokenAddress',
        'fromAddress',
        'transfers',
        'totalPrice',
        'deadline',
    ];
    const distributionParams = [];
    orderPropertiesToExtract.forEach(key => {
        // Check if the property exists in the object
        if (paymentIntentResponse.parameters.hasOwnProperty(key)) {
            // Retrieve the value and push it into the orderedParams array
            distributionParams.push(paymentIntentResponse.parameters[key]);
        }
    });
    const functionCall = { functionName, func, parameters: [...distributionParams, ...permitTransactionParams] };
    return getGaslessTxToSign(chainId, contractAddress, provider, functionCall);
}
export async function getPaymentTransactionSignatureData(wallet, intent) {
    const buyersAddress = await wallet.getAddress();
    const permitTypeData = await getSignERC20Permit(buyersAddress, intent, wallet);
    const permitTxSignature = await wallet._signTypedData(permitTypeData.domain, permitTypeData.types, permitTypeData.value);
    const paymentMetaTransaction = await buildPaymentTransaction(permitTxSignature, intent, wallet);
    // Sign meta transaction for token distribution.
    const paymentTxSignature = await wallet._signTypedData(paymentMetaTransaction.domain, paymentMetaTransaction.types, paymentMetaTransaction.value);
    const metaTransactionDeadline = paymentMetaTransaction.value.userDeadline;
    return { paymentTxSignature, permitTxSignature, metaTransactionDeadline };
}
const chainInfo = {
    'polygon': {
        chainId: 137
    }
};