// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * 報酬プールからの Claim。バックエンドの EIP-712 署名により「このアドレスがこの量を引き出してよい」を検証し、
 * プールから transfer する。ユーザーが claimEIP712 を呼ぶのでガス代はユーザー負担。
 * domain(chainId, verifyingContract) と deadline / campaignId でチェーン・コントラクト・用途を分離。
 */
contract RewardClaim {
    IERC20 public immutable seedToken;
    address public immutable pool;
    address public immutable signer;

    mapping(bytes32 => bool) public usedNonces;

    // EIP-712
    bytes32 public constant CLAIM_REQUEST_TYPEHASH =
        keccak256("ClaimRequest(address recipient,uint256 amount,uint256 nonce,uint256 deadline,bytes32 campaignId)");
    bytes32 public immutable DOMAIN_SEPARATOR;

    event Claimed(address indexed user, uint256 amount);

    constructor(address _seedToken, address _pool, address _signer) {
        seedToken = IERC20(_seedToken);
        pool = _pool;
        signer = _signer;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("BirdGame Claim")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * EIP-712 署名で検証。domain に chainId/verifyingContract、payload に deadline/campaignId を含める。
     * 期限切れ・nonce 重複・署名不正は revert。
     */
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

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_REQUEST_TYPEHASH, recipient, amount, nonce, deadline, campaignId)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        require(!usedNonces[digest], "RewardClaim: nonce already used");
        usedNonces[digest] = true;

        address recovered = ecrecover(digest, v, r, s);
        require(recovered == signer && recovered != address(0), "RewardClaim: invalid signature");

        require(IERC20(seedToken).transferFrom(pool, msg.sender, amount), "RewardClaim: transfer failed");
        emit Claimed(msg.sender, amount);
    }

}
