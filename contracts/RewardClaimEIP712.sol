// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * 報酬プールからの Claim（EIP-712 版）。
 * バックエンドの EIP-712 署名により「このアドレスがこの量を引き出してよい」を検証し、
 * プールから transfer する。deadline と campaignId で用途・有効期限を分離。
 */
contract RewardClaimEIP712 {
    IERC20 public immutable seedToken;
    address public immutable pool;
    address public immutable signer;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline,bytes32 campaignId)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(bytes32 => bool) public usedNonces;

    event Claimed(address indexed user, uint256 amount);

    constructor(address _seedToken, address _pool, address _signer) {
        seedToken = IERC20(_seedToken);
        pool = _pool;
        signer = _signer;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("RewardClaim")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function claimEIP712(
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes32 campaignId,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "RewardClaim: signature expired");
        require(recipient == msg.sender, "RewardClaim: recipient must be caller");

        bytes32 structHash = keccak256(abi.encode(
            CLAIM_TYPEHASH,
            recipient,
            amount,
            nonce,
            deadline,
            campaignId
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = ecrecover(digest, v, r, s);
        require(recovered == signer && recovered != address(0), "RewardClaim: invalid signature");

        bytes32 nonceKey = keccak256(abi.encodePacked(recipient, nonce));
        require(!usedNonces[nonceKey], "RewardClaim: nonce already used");
        usedNonces[nonceKey] = true;

        require(IERC20(seedToken).transferFrom(pool, recipient, amount), "RewardClaim: transfer failed");
        emit Claimed(recipient, amount);
    }
}
