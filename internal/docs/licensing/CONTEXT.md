# React on Rails RSC License

This context defines the language used to describe how commercial licensing
and attribution apply across React on Rails Pro and its related components.

## Language

**Product-Level Attribution**:
A single attribution obligation for the integrated React on Rails Pro product,
satisfied by the part of the product that emits the attribution. A related
component has no independent attribution obligation when it does not emit the
attribution itself. Both paid subscribers and Complimentary OSS licensees must
retain the product-level attribution. Free educational, demo, tutorial,
workshop, and personal or hobby users must retain it as well.
_Avoid_: Per-package attribution, RSC attribution

**Attribution-Covered Plan**:
Any recognized React on Rails Pro plan: `paid`, `partner`, `startup`, `oss`,
`nonprofit`, or `education`. Runtime policy reports attribution as required for
all of them. These are operational entitlement or billing labels, not separate
legal license categories.
_Avoid_: Attribution-optional plan, paid-only attribution

**Legal License Category**:
One of the durable categories defined by the canonical EULA: paid Production
Use, Complimentary OSS Production Use, or royalty-free non-Production Use.
Operational plan labels do not create different legal rights unless the EULA
expressly says so.
_Avoid_: Plan code, billing tier

**Authorized Free Use**:
Royalty-free non-Production Use expressly permitted by Section 4 without a paid
or Complimentary OSS license. The general restriction on unlicensed use does
not prohibit this category.
_Avoid_: Unlicensed Production Use, evaluation license

**Credential Status**:
The public suffix generated from the renderer's available license credential.
`UNLICENSED` means no credential was present; it does not by itself establish a
license violation because Authorized Free Use may lawfully have no credential.
_Avoid_: Compliance verdict, use classification

**Commercial RSC Source Header**:
The established React on Rails Pro proprietary source-header structure and
AI-agent warning, adapted for the current RSC package. Team-authored source is
commercially licensed to outsiders. Actual third-party notices, such as Meta's
notice on the derived Webpack plugin, remain attached to the applicable code;
current source headers do not promote historical licensing alternatives.
_Avoid_: Bespoke RSC header, general contributor-license qualifier

**Current Commercial Boundary**:
Beginning with `react-on-rails-rsc` 19.2.1, the package is commercially licensed.
Current headers, README, and changelog communicate that boundary without
encouraging use of older releases. The existing repository and history remain
in place, and applicable third-party notices remain preserved.
_Avoid_: Republished repository, prior-release promotion

**EULA 2.3 Boundary**:
The corrected canonical EULA version effective for `react-on-rails-rsc` 19.2.1
and React on Rails Pro artifacts published with the next 17.0.0 release
candidate.
_Avoid_: Silent EULA revision, EULA 2.2 amendment

**Organization-Owned Use**:
Use of the Software in the licensee Organization's own applications, websites,
or services, whether internal or publicly accessible. This does not permit
redistribution of the Software or extend the Organization's license to client
organizations.
_Avoid_: Internal applications only, unrestricted third-party hosting

**Express-Term Grant**:
A paid license remains effective subject to the EULA's stated fee, term, and
termination provisions rather than an unqualified right of at-will revocation.
Complimentary OSS revocation remains governed by its express Section 4.1 terms.
_Avoid_: Revocable license

**Attribution Provider**:
The single part of the integrated product responsible for emitting attribution
on behalf of the product as a whole.
_Avoid_: Every licensed package, attribution package

**Covered HTML Document**:
An HTML document containing output rendered by the integrated React on Rails
Pro product. It carries one product-level attribution regardless of how many
related components contributed output; unrelated documents are not covered.
_Avoid_: Every application page, per-component attribution

**Generated Attribution**:
The complete attribution comment emitted by the Attribution Provider, including
its license-status suffix but no licensee identity. A covered licensee retains
it without modification.
_Avoid_: Base attribution text, editable attribution
