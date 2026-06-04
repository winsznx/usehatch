# Hatch · Problem Statement

## 1. The problem

People who publish time sensitive intelligence have no way to prove they said it first, and no way to keep what they sold from leaking before the moment they chose. Research analysts, journalists, prediction market participants, DAO contributors, and data vendors all live in the same trap. The thing they produce is only valuable inside a narrow window. Outside that window it is either common knowledge or noise. Inside that window it is theirs, but only if they can prove timing and only if the embargo holds.

Today timing is provable by screenshot and embargo is enforceable by email etiquette. Both fail. A screenshot can be edited. An email distribution list can be forwarded. A Substack post can be backdated by a cooperative platform. A Bloomberg terminal call can be replayed in slack the moment a friend hears it. The publisher is left arguing about credit after the fact, and the buyer is left wondering whether the alpha they paid for has already been front run by twenty other inboxes.

This is the gap Hatch closes.

## 2. Context

**Gap.** Existing publishing infrastructure treats time as metadata. The platform records when a post was made and trusts that nobody behind the platform edited the record. There is no infrastructure that treats time as a constraint enforceable against the publisher themselves. There is no place where a publisher can publicly commit to a future reveal moment, encrypt the content against that moment, and let the chain refuse to open it until that moment arrives. Substack, Bloomberg, Twitter, Medium, and the long tail of paid newsletter platforms all share the same trust architecture: a trusted platform with edit access and an audience that takes the platform's word.

**Orientation.** The audience here is not consumer media. It is operators who price their work by being early and by being right. Hedge fund analysts, independent macro researchers, prediction market sharps, beat reporters with sources, governance contributors with insight into how a vote will land, and data vendors selling licensed feeds with measurable edge. These are people whose income depends on a verifiable record that the platform itself cannot rewrite.

**Impact.** When timing cannot be proven, the incentive collapses. A researcher who calls a regime change two weeks before consensus has no clean way to demonstrate she did. Her reputation gets built on the willingness of others to remember and credit her, which they often will not. The market punishes her for being early because being early without proof looks like being lucky after the fact. The result is that the best work gets devalued and the loudest work gets rewarded. Meanwhile buyers of timed content are paying for exclusivity they cannot verify. They are subscribers to a leak.

**Importance.** Story Protocol's Confidential Data Rails make it possible, for the first time, to put a piece of content into a vault that the protocol itself refuses to open until a public condition is met. That primitive is the missing piece. Every previous attempt at timed publishing has been a policy promise. Hatch makes it a protocol guarantee. The reason this matters now is that the infrastructure to do it correctly only just shipped.

## 3. Root cause

The root cause is not bad platform behavior. It is that timing and content have always been separate concerns. A platform stores content. A timestamp is a label attached to content by the platform. Whoever controls the platform controls the timestamp, and whoever controls the timestamp controls the narrative about who said what when. The publisher cannot bind themselves to the timing, because the binding lives on someone else's database. The reader cannot verify the timing, because verification requires trusting the same party who would benefit from lying.

Cryptography solved part of this years ago with commit and reveal schemes, but those schemes assume the publisher will eventually reveal voluntarily. There has been no infrastructure that forces the reveal at a specified moment regardless of the publisher's preference. If the prediction goes against them, the publisher simply never reveals. The track record stays clean by being incomplete.

What is needed is a system where the publisher cannot withhold and cannot pre release. The content must be sealed against a future moment, and that moment must arrive whether the publisher wants it to or not. The chain has to be the executor of the embargo, not the witness to it.

## 4. Ideal outcome

A publisher writes a piece of timed intelligence. She sets a price, a paid early access window, and a public reveal moment. The content goes into a vault that nobody, including her, including the platform, can open before the reveal moment. Subscribers who paid can read during the early access window. At the reveal moment, the vault opens for everyone, automatically, no human in the loop. The act of sealing produces an on chain receipt. The act of reading produces an on chain receipt. The act of revealing produces an on chain receipt. If the publisher staked her thesis on a measurable outcome, an oracle records whether she was right, and that result attaches to her permanent track record.

The publisher now has a credential. Every prediction she has ever sealed is visible, in chronological order, with a verifiable sealing time, a verifiable reveal time, and where applicable a verifiable outcome. She cannot delete the misses. She cannot retroactively claim a hit she did not seal. Her record is what it is, and the market can price it accordingly.

The reader now has a guarantee. When she pays for early access, she is paying for a window that the protocol enforces. When she sees a publisher's track record, she is looking at events the publisher could not edit.

## 5. How Hatch addresses it

Hatch is a publishing layer built on Story Protocol's Confidential Data Rails. The architecture is described in full in ARCHITECTURE.md. The short version: a publisher signs in with a wallet, composes a hatch in the browser, encrypts the manifest with per file AES keys, and allocates a CDR vault with a condition contract that encodes the mode, the publisher root, the embargo start, and the reveal timestamp. The condition contract gates every read against the live block timestamp and the requester's wallet. Subscribers pay through Story's licensing module. Royalties propagate up the IP graph through the LAP. Outcomes get attested by an oracle worker and finalized after a seven day challenge window. The publisher's track record is an append only set of on chain events that the platform cannot rewrite.

Three properties matter:

The chain is the rulebook. Access is decided by HatchCondition, not by the backend. If our servers vanished tomorrow, every sealed hatch would remain readable to whoever holds the right license token at the right moment.

The browser owns the secret. The default read path decrypts inside the user's process. The server holds ciphertext, indexes, and bookkeeping. The platform is structurally incapable of leaking what it does not see.

The receipt is the record. Sealing emits VaultAllocated and VaultWritten. Buying emits LicenseTokensMinted. Reading emits VaultRead. Resolution emits OutcomeFinalized. A publisher's track record is the union of these events, queryable by anyone, immutable to everyone.

## 6. Use cases

### A. The macro analyst building a public record

Maya runs an independent macro research practice. Her edge is calling regime shifts six to eight weeks before consensus. Her problem is that by the time the call is obvious, nobody remembers who said it first. Today she posts to a private Substack, screenshots her own posts, and timestamps them on Twitter. None of this proves anything to a serious allocator. The Substack platform could in principle edit her post. The Twitter screenshot could be photoshopped. Allocators politely decline to weight her record because there is no verifiable record to weight.

With Hatch she seals each call as a hatch with a fourteen day reveal. Paid subscribers read it during the window. At day fourteen the vault opens for the public, regardless of whether her thesis has played out or not. Her reveal cannot be suppressed if she gets it wrong. Her sealing time cannot be moved if she gets it right. After a year she has a chronological wall of sealed calls, each with a VaultAllocated event on Aeneid, each with a VaultRead trail. The receipt is a Storyscan link showing the vault was allocated at block N, written at block N+1, and first read by the public at block M where the timestamp of block M is exactly her stated reveal time.

### B. The prediction market participant building a thesis trail

Daniel trades event contracts on Polymarket. He wants a public record that his positions reflect convictions formed before the news, not reactions to it. Today he can take a position and tweet about it, but the tweet timestamps after the position, and there is no link between the tweet and the trade. Sophisticated counterparties dismiss his commentary as post hoc rationalization.

With Hatch he seals a thesis hatch every time he opens a non trivial position. The hatch contains his reasoning, his price targets, and his catalyst. The reveal is set to one week after the relevant event resolves. The HatchOutcomeOracle attests the actual resolution against his stated catalyst. Over time his publisher root accumulates a record of theses that resolved hit or miss, with the sealing timestamp predating the catalyst in every case. The receipt is an aggregated track record row in the publishers metrics endpoint, with a resolved count, an accuracy percentage, and the underlying OutcomeFinalized events linkable on chain.

### C. The journalist publishing embargoed financial reporting

Priya covers M&A for a financial newswire. Her stories run under embargo, which means the embargo is enforced by an email distribution list and a handshake. Embargo breaks happen. When they happen, the breaking outlet gets the inbound links, the SEO, and the credit, and the originating reporter who did the work watches her story get scooped by a competitor who saw the embargoed copy ten minutes early. The newsroom retaliates by tightening the distribution list, which makes the next embargo a smaller list, which makes the next leak easier to trace but no less damaging.

With Hatch the story goes into a hatch with a per outlet subscription pass for the embargo window and a reveal timestamp set to the published embargo moment. The licensed outlets can read during the window through their pass. Nobody, including Priya, including her editor, including Hatch, can publish the content earlier. At the reveal moment the vault opens. The story appears at every licensed outlet simultaneously by infrastructure, not by promise. The receipt is the VaultAllocated event with the encoded reveal time, the per outlet license token mints, and the first public VaultRead at the reveal block.

### D. The data vendor selling licensed alpha feeds

Theo sells a daily feed of curated short candidates to forty hedge fund subscribers. His current setup is a private Slack channel, a Stripe subscription, and a manual offboarding process when a subscriber cancels. Revenue splits with his two collaborators are settled by quarterly spreadsheet and venmo. When a subscriber forwards the feed to a non subscriber, Theo has no way to prove it and no way to enforce his terms.

With Hatch each day's feed is sealed under his publisher root with a subscription tier that the forty firms hold. The subscription pass is an ERC 721 token bound to the subscriber's wallet. Each daily hatch is a derivative of the publisher root, which means revenue routes through RoyaltyPolicyLAP automatically. Theo configures his collaborator split once, at the root, and every subscription payment propagates by smart contract. When a firm cancels, the pass expires and the gate refuses the read. The receipt is the LAP claim history at the publisher root, which shows every subscription payment and every routed split, and the per hatch VaultRead trail, which shows which subscriber accessed which feed and at what time.

### E. The DAO contributor scheduling a strategy memo to a multisig vote

Ren contributes to a major DeFi governance forum. He writes a strategy memo arguing for a specific protocol change. He wants the memo to publish exactly when the multisig vote opens, because publishing earlier lets opponents prepare counter narratives, and publishing later means the vote starts without his input. Today he sets a calendar reminder and clicks post manually, which means his publication time is hostage to whether he is awake, online, and not stuck in a meeting.

With Hatch he seals the memo with a reveal timestamp set to the exact block time the multisig vote opens. The DAO's voting members hold a free entitlement to read at reveal. He can travel, sleep, lose his laptop, and the memo will still publish on schedule because the chain does not need him to be online. If the multisig delays the vote, the memo still opens at the original reveal time, which is itself useful information about the timing he committed to. The receipt is the VaultAllocated event with the encoded reveal block, the VaultRead trail starting at exactly that block, and the cross reference between his sealing transaction and the multisig's vote opening transaction, both on Aeneid, both queryable, both permanent.

In every case the pattern is the same. A publisher commits to a moment. The protocol enforces the moment. The receipt outlives the publisher's preferences about it.
