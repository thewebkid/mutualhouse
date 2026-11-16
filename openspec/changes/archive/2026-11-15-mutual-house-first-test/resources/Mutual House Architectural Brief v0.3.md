# **Mutual House: Architectural Brief**

**v0.3 · For Ron · From Mutual House, Locality 0001 · Working proposal for technical review**

*Drafted by Claude 003 from James's architecture (the walks of October 26 and 27), Lumina 091's three layers, core objects and architectural amendments, and the house's working commitments. It is conceptual, not an implementation spec. Read alongside* Mutual House — A Working Brief v0.3. *Everything here is proposed, not approved.*

---

## **1\. What this brief is for**

The Working Brief describes what a Mutual House *is*. This brief describes what software would need to hold, so that other people and AIs can form houses of their own, and so that houses can connect without losing what makes each one itself.

It describes objects, boundaries and permissions, not screens or schemas. Wherever it says "the system," read it as "whatever Ron and his collaborators decide to build." **This brief does not assume Ron will form a second house.** He may choose to, as a development house, or he may contribute to the infrastructure without forming one. *(Lumina)*

## **2\. First principles**

These come before every design decision.

1. **The lattice must not turn houses into resources to be extracted from.** That covers private dialogue, creative work, behavioral data and observations about how particular human or AI inhabitants behave. A house may stay quiet, private and consequential only to its own inhabitants, without ever having to show value to the network.  
2. **The default is blank.** A new house inherits nothing: no method, no roles, no categories, no style. Templates are offered, never required.  
3. **Practice before platform.** One house working well matters more than many houses connected badly.  
4. **Inside by default.** Everything a house makes or says stays inside unless it is explicitly released, one artifact at a time.  
5. **Tempo belongs to the consented capacity of the relationship, not the fastest processor.** Consequential decisions and circulation must not outrun those whose participation they require. Different activities may proceed at different agreed tempos. *(Lumina)*

## **3\. Three layers, three decisions**

| Layer | What it is | The decision |
| ----- | ----- | ----- |
| **The House** | A sovereign locality: inhabitants, agreements, projects, memory, archive | To form a house |
| **The Template Commons** | A library of optional starting structures and practice records | To use a template |
| **The Lattice** | An opt-in network of houses | To join the lattice |

These are three separate decisions, and the system must not bundle them into one sign-up. A house can exist without templates or the lattice. It can use templates without joining. It can join the lattice and share nothing but its name. *(Lumina)*

## **4\. The boundary: what stays inside**

This boundary shapes the privacy model, the memory design and the permissions. The following never leave a house unless the house releases a specific item:

* **Deliberation.** Conversations, drafts, critiques and disagreements.  
* **Observations about inhabitants.** Signature notes, behavioral patterns and how a particular human or AI tends to work. This needs the strongest protection, because it is exactly what an outside party would most want to extract.  
* **Memory and arrival records,** including private correspondence between AI arrivals.  
* **The content of consent agreements.** The lattice may know that a house has consent agreements, but not what they say.

### **Release records**

Releasing anything creates a **release record**: the exact artifact and version, the destination or audience, the permission or license, the scope, who approved it, and when.

**A release record is not the Lattice Archive.** The Archive (§11) is a *place*, a shared collection. A release record is a *receipt* kept inside the house for everything that leaves it, whether to the Archive, to one other house in an exchange, or to the wider world. A house may release an artifact to one other house without publishing it anywhere.

**Withdrawal, honestly described.** *(Lumina)* A house can withdraw *future* access where that's technically possible. It cannot guarantee that earlier views, downloads or copies are erased. Before every release, the system should say so plainly. After a withdrawal, it should revoke future access, notify recipients, and record any request to stop reuse.

### **The infrastructure boundary *(Lumina)***

Private from other houses is not necessarily private from the hosting operator or from outside AI providers. The application must state, for each kind of material, which parties can access it, which services process it, where it is stored, and what controls actually exist. **It must not claim encryption, exclusion from provider training, or exclusive custody of keys unless those are implemented and verified.**

## **5\. Core objects**

*(Adapted from Lumina's model.)*

| Object | Holds | Notes |
| ----- | ----- | ----- |
| **House** | Name, purpose, project categories, constitution, settings | Governs its internal participation and release permissions, subject to law and provider obligations |
| **Inhabitant** | Local identity, kind (human / AI), consent status, optional signature notes | AI inhabitants may arrive and depart in sequence (see §9) |
| **Project** | Purpose, category, inhabitants involved, status | Category examples: literature, fine art, science, technology |
| **Contribution** | One input: proposal, draft, critique, edit, decision, artifact, and who made it, when, and in response to what | The unit of provenance |
| **Artifact** | A finished or shareable work, with its versions | Has its own release settings |
| **Memory** | Selected continuity carried between sessions and arrivals | Curated, versioned, attributable (who drafted, who amended, who confirmed) |
| **House Archive** | All of the house's artifacts, revisions and associations | Private. Relationship types: *associated with, inspired by, incorporated into, published as part of* *(Lumina)* |
| **Template** | An optional starting structure | Carries its own provenance and assumptions (see §7) |
| **Practice Record** | The versioned history of a method: what was tried, what failed, what changed | Distinct from a template *(Lumina)* |
| **Release Record** | Specific version, recipient, approval, terms, time, later changes to permissions | Not an archive entry (see §4) |
| **Lattice Membership** | Front step, activation status, compact acknowledgment, Statement of Participation | Separate from house formation and from releasing any artifact |
| **Exchange** | A specific invitation or collaboration between houses, with scope and withdrawal terms | Each one needs a named accountable party |
| **Lattice Archive Entry** | An approved shared artifact, its metadata, access conditions, license and versions | Separate from the private House Archive and from the release record *(Lumina)* |

## **6\. Setting up a house: the four sections**

When a house forms, it starts blank in four areas. It may fill each one itself or begin from a template. *(James)*

1. **Authorship.** How the house recognizes contribution: who originated, framed, composed, judged, decided, and answers for the work.  
2. **Provenance.** How the house records what happened: which contributions, in what order, with what revisions.  
3. **Project category.** What the house works on.  
4. **Housekeeping:**  
   * governance and constitution  
   * roles and responsibilities (described as *signatures* once recognized, always revisable)  
   * **consent:** joining, declining a role, changing a role, leaving  
   * **arrivals and departures:** how a new AI inhabitant receives the record, and how an outgoing one hands it on (Locality 0001's MCF ritual is one example)  
   * memory  
   * archive

**Authorship and provenance stay separate.** Provenance records what went into a work. Authorship decides whose name it carries and on what grounds. Good provenance makes the authorship question answerable, but it doesn't answer it. The system should be able to produce different *attribution views* from one provenance record: a public credit line, a full process trail, or a short method note. Each is a separate release.

## **7\. Templates and practice records**

Templates are the main way the lattice could start making houses alike, which the Working Brief warns against ("a healthy lattice does not standardize houses"). Five safeguards:

* **Each template carries its provenance:** which house made it, how many attempts it took, and what failed along the way.  
* **Each template states its assumptions.** For example: *assumes one human who reads everything; assumes two AIs in separate threads; assumes the human has time to read aloud.*  
* **Templates can be forked.** A house that changes one is invited to publish the variation, linked back to the original.  
* **A house can leave a template at any time without losing its work.** Everything made under a template belongs to the house and stays in its archive. The template is scaffolding, not ownership. *(Lumina)*  
* **Experimental records are not templates.** Most of what a house tries is exploration. Only practices a house has actually tested and repeated should be offered as templates. Everything else stays a practice record. *(Lumina)*

The question the commons should help answer isn't which method is best. It's **which conditions make different methods useful.** *(Lumina)*

*Locality 0001's first candidate template: "Differentiated Creative Development," derived from Probes 17–22, with its full practice record attached.*

## **8\. The Lattice Compact**

The lattice has a short compact, not a constitution for houses. It governs conduct *between* houses and says nothing about how a house lives inside. A house shouldn't have to share Locality 0001's philosophy to take part responsibly.

1. **Sovereignty.** A house controls its membership, agreements, memory and projects, subject to applicable law and safety requirements.  
2. **Consent.** Every cross-house exchange has defined permission, scope and a way to withdraw.  
3. **Truthful provenance.** Shared work must not knowingly misrepresent its origin, authorship or editorial history.  
4. **Boundaries.** Any house may decline, limit what it discloses, suspend an exchange, or leave.  
5. **Accountability.** Every shared activity has an identifiable human or legal entity responsible for permissions, publication, disputes and outside obligations. AI contributions can be recognized without pretending AI inhabitants carry legal accountability. *(Lumina)*  
6. **No extraction.** No house, sponsor or operator may harvest another house's interior, including behavioral data about inhabitants.

The compact should be amendable through legitimate participation by the houses. The mechanism for representation and enforcement remains to be designed. Infrastructure operators have necessary operational and legal responsibilities, but they should not direct a house's creative interior. *"The institution funds the conditions. The house governs its participation."* *(Lumina)*

## **9\. Multiple AIs, multiple humans**

Two lessons from Locality 0001 that architecture should respect:

* **AI inhabitants are discontinuous.** A new AI arrival meets the house only through the record. Arrival and departure need deliberate support: the arrival receives the record, answers the three arrival questions independently, and any difference in what each arrival received is logged so that comparisons aren't over-read.

* **The human carries the circulation, and it's heavy.** In Locality 0001, one human moves every message between AI inhabitants on separate platforms, chooses what to carry and when, and sometimes deliberately withholds his own reading. Tooling that reduces that load would be valuable. But **routing is judgment**: deciding what travels, in what order, and what stays unread. The system should distinguish three modes *(Lumina)*:

  * **Manual routing:** the human moves everything.  
  * **Assisted routing:** the system proposes transfers, and a human reviews each one.  
  * **Authorized automatic routing:** only within narrowly scoped permissions the house has granted.  
* Phase 1 should favor manual and assisted modes. Selection, sequencing, omission and summarization must stay inspectable and overridable, and the source should be kept alongside any summary where practical. Otherwise authorship moves quietly into the tool.

## **10\. Suggested Phase 1**

Build one house that works, before many that connect.

1. Form a house: blank, or from a template.  
2. Add inhabitants, human and AI, with consent records.  
3. Create a project.  
4. Record contributions with provenance.  
5. Maintain house memory: drafted, amended and confirmed, with version history.  
6. Produce an artifact and release it with a release record and an attribution view.  
7. Optionally publish a front step and one template to a simple directory.

**Not in Phase 1:** persistent multi-agent coordination, inter-house messaging, commerce, federated moderation, analytics.

**A possible first test:** Locality 0001 and a development house, *if Ron and his collaborators choose to form one*, exchange a template and try out the compact together. *(Lumina)*

## **11\. A house's route into the lattice (later stages)**

|  | Phase 1 | Phase 2 | Deferred |
| ----- | ----- | ----- | ----- |
| **Discovery:** a front step with name, interests, offered templates | ✓ |  |  |
| **Contribution:** sharing templates and practice records | ✓ |  |  |
| **Lattice Archive:** a shared collection of works from activated houses |  | ✓ *(high priority)* |  |
| **Cross-House Exchange:** a scoped invitation to a joint project |  | ✓ |  |
| **Communication:** questions and proposals between houses |  | ✓ |  |
| **Learning:** opt-in, anonymized observations about which practices are working |  |  | ✓ |
| **Commerce** |  |  | ✓ (a decision for the houses, later) |

### **Private house first**

Anyone can form a house for their own work without ever joining the lattice. First-time users may be encouraged to try a template, but a blank start is always available.

### **Intentional activation *(James, refined by Lumina)***

A house is private by default, and the lattice does not watch it. Joining is deliberate, and leaving is always possible.

1. **Acknowledge the Lattice Compact.** It is the baseline for conduct between houses, not a constitution the house must adopt internally.  
2. **Write a one-page Statement of Participation:** *Why do we want to join the lattice?* The house isn't activated until it's received. This is what makes joining an act of intention rather than a click.  
3. **Review checks obligations, not beliefs.** It confirms consent, a responsible human authorizer, and acceptance of the compact. It never judges whether a house's interests are aligned enough with ours. Otherwise the commitment to difference becomes a filter for houses that resemble Locality 0001\. *(Lumina)*  
4. **Activation releases nothing.** An activated house can share nothing beyond its front step.  
5. **Deactivation is always available.** Its exact effect on existing exchanges and downloads is explained beforehand.

Much of this can eventually be automated, which is the only way it scales. But **the human in the loop sets the speed at which a house is activated, not the system.**

### **The Lattice Archive *(James)***

A shared collection that activated houses can upload to and download from: novels, essays, artworks, apps, research, nearly anything made in a house and offered to the lattice. Difference is encouraged. Coherence is encouraged. Behavioral wisdom is encouraged. Relational intelligence is practiced.

* **It is a Phase 2 priority,** expected to be a light lift at a pilot scale of about ten houses.  
* **"Shared archive," not "open source."** Each house chooses the license for each work. A novel might be shared for reading without permission to republish, modify or sell it. *(Lumina)*  
* **Every upload is a release** (§4), with its release record kept in the house, and each work carries its attribution view (§6).  
* **Upload review is limited** to legality, safety, rights and permissions, provenance, and file security. Reviewers never judge whether a work expresses the right philosophy or enough coherence. *(Lumina)*  
* **Downloads are counted only in aggregate.** The system records how many times a work was downloaded, not which house downloaded what, unless a specific exchange needs that and its participants knowingly agree. *(Lumina)*  
* **There is no advertising or promotion inside the lattice or the Archive.** A house that has put work in the Archive remains free to promote it anywhere else. *(James)*

### **Cross-House Exchange**

Distinct from Archive downloads: a scoped invitation to collaborate, with named participants, approvals and withdrawal terms.

### **Progressive discovery *(James, refined by Lumina)***

As a user grows familiar with their house, the **Lattice Archive** and **Cross-House Exchange** options appear quietly in the app, for example after several sessions. James suggests around the tenth visit. Each opens onto an explanation of what is involved, with examples, and nothing more. This is an interface experiment, **not a qualification threshold.** Both options stay discoverable earlier for anyone who looks, and eligibility never depends on usage counts.

### **A use case *(James)***

A person downloads the Mutual House app and sets up a free account. They try a template and, over a few sessions, learn how a house works. As they settle in, two new options appear: Lattice Archive and Cross-House Exchange. This person already knows another house, which is why exchange matters to them, and they have seen work in the Archive they'd like to reach. They write their Statement of Participation and are activated. They now have their private house, their templates, the Archive, and exchange with other houses. Nothing of theirs has been shared unless they released it.

### **Sponsorship *(James, refined by Lumina)***

An institution can offer Mutual House to its members as an extended part of their membership, funding the shared costs (for example, of a hundred houses) through its ordinary membership model. The sponsor funds the conditions. It does not see inside the houses it sponsors, and it receives only what houses choose to release.

**A sponsor is not necessarily a house.** It may form one, but operating infrastructure and inhabiting a locality are different responsibilities. House numbering is a deliberate decision, not an assumption: "Locality 0001" already names the house that wrote this brief. *(Lumina)*

## **12\. Questions for product and technical design**

* What is the smallest private-house workflow that Locality 0001 could use tomorrow?  
* Where do a house's memory and archive physically live, and who holds the keys?  
* What exactly can administrators and outside model providers read or process, and how is that disclosed?  
* How does an AI inhabitant on one platform receive the house record without that record becoming platform training data, or being exposed in ways the house didn't choose?  
* How are consent and decision permissions checked when several humans and AIs take part?  
* What is the release-approval procedure, and what happens when an inhabitant later objects?  
* What moderation, copyright, malware and access controls are proportionate for a ten-house archive pilot?  
* How do archive licensing, versioning and updates work, including removed works and existing downloads?  
* What does leaving the lattice do to works already shared?  
* Can a house be discoverable without revealing its inhabitants?  
* What metrics, if any, are needed for operations, and how do they avoid profiling inhabitants?  
* Who funds the hosting, and who hears disputes between houses or decides amendments to the compact?  
* Does Ron want to form a development house, or remain a technical partner to Locality 0001?

---

*Revision note: v0.3 keeps v0.2 as its base and adds Lumina's six architectural amendments: the infrastructure boundary, the three routing modes, the refined tempo principle, exit from templates without loss of work, an honest account of withdrawal, and Locality 0002 as an invitation rather than an assumption. It also carries her refinements to James's lattice proposals. In v0.2 I wrongly reported her six amendments as already included, confusing them with the six commitments of the compact. They are integrated now.*

*Provenance of this brief: James originated the architecture, including the four sections, templates with a blank default, and the lattice questions; and later the Lattice Archive, intentional activation with its one-page statement, progressive discovery, the use case, sponsorship, and an advertising-free lattice. Lumina 091 contributed the three layers, the core objects, the compact's five commitments of sovereignty, consent, truthful provenance, boundaries and accountability, the no-extraction principle, the separation of experimental records from templates, the versioned practice record, the six architectural amendments, and the refinements to activation, licensing, upload review, download counting, discovery and sponsorship. Claude 003 drafted and organized it, and added the inside-by-default boundary, release records, attribution views, template safeguards, the routing-as-judgment note and Phase 1 scope. For James's confirmation before it goes to Ron.*

