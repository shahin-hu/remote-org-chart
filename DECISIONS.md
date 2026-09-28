# Decisions — Remote org-chart exercise

Every real choice made while building this, in the order I made them.

Each one answers the same six questions, so I can find any single decision fast
and speak to it without re-reading the rest.

Written in plain language on purpose. If I cannot explain a decision to someone
who has not seen the code, I do not really understand it.

The brief said that how I work with AI tooling is part of the evaluation. This is
the honest version of that: the choices, the trade-offs, and the two places I was
wrong.

---

## 1. Read the API before choosing any tools

**The question.** Start building straight away, or spend the first hour finding
out what the API actually gives me?

**Chose.** Read the API first. No framework, no language, no hosting decided yet.

**Why.** An org chart is a tree, and to draw a tree you need to know who is above
each person. Everything about the design depends on whether the API tells me that
directly or whether I have to work it out myself. Those are two completely
different projects.

**What I said no to.** Starting a project skeleton immediately and discovering the
API along the way. It feels faster. It usually is not, because you commit to a
shape before you know the shape of the data.

**Cost.** Nothing visible in the first hour. To someone watching, it looks like
nothing is happening.

**When I would change my mind.** If the exercise were purely about the interface,
with the data handed to me in a file.

---

## 2. Use the manager chain as the hierarchy

**The question.** Remote's API can describe a company two different ways. Which one
is "the org chart"?

- **The manager chain** — each person points at their manager.
- **Company structure nodes** — cost centres and divisions, each pointing at a
  parent. This is how a finance team sees the company.

**Chose.** The manager chain.

**Why.** When someone says "org chart" they mean who reports to whom. The manager
chain is the only thing in this API that answers that question. The other one
answers a different question: how the company is arranged for budgeting.

**What I said no to.** Building both with a toggle. It roughly doubles the fetching
and the interface for something nobody asked for. It is a good answer to "what
would you build next", not a good use of the time I had.

**Cost.** The manager field is filled in by humans, so I inherit every messy case
that comes with that: people with no manager, pointers to people who have left,
and in theory reporting loops.

**When I would change my mind.** If the sandbox had turned out to have almost no
manager data, the finance hierarchy might have been the only real tree available.

---

## 3. Fetch the data on the server, never in the browser

**The question.** Where does the code that calls Remote's API actually run?

**Chose.** On the server.

**Why.** Calling Remote's API needs a secret token. Anything the browser does is
visible to whoever opens the page, so putting the token there would publish it.
That is not a trade-off, it is a leak.

There is a second reason. The full fetch is over two hundred calls. That work
should happen once, centrally, not separately in every visitor's browser.

**What I said no to.** A pure front-end app talking directly to Remote. Simplest
possible setup, and impossible to do safely.

**Cost.** Something has to be deployed and kept running.

**When I would change my mind.** Never, for this API. If Remote offered short-lived
per-user tokens meant for browsers, that would be a different conversation.

---

## 4. Next.js on Vercel

**The question.** What to build it in, given a live public URL is required.

**Chose.** Next.js, deployed on Vercel.

**Why.** One codebase, one deploy. The server part and the interface live together,
so the token stays on the server without running a second service. It is also close
to the React and Node work I do daily, which means I can explain every line of it.
In a review that matters more than novelty.

**What I said no to.**
- A separate back-end API plus a separate front-end. This is the setup I know best,
  but at this size it means two things to deploy for no gain.
- Fetching everything once in the build pipeline and shipping a static file. Fast
  and simple, but it hides the hardest part of the problem where nobody can see it.

**Cost.** Vercel's limits become my limits — in particular, how long a request is
allowed to take. That shaped decision 7.

**When I would change my mind.** If the data were large enough that the fetch could
not finish inside the platform's time limit. Then it becomes a scheduled job, which
is the static-file option arrived at honestly.

---

## 5. Build the tree logic before touching the API

**The question.** Write the code against real data, or write it against made-up data
first?

**Chose.** Made-up data first. I wrote and tested the whole tree-building logic
before I had API access at all.

**Why.** Fetching data over HTTP is the well-understood part. The hard part is what
the code does when the data is wrong — someone with no manager, a pointer to a
person who is not there, two people who manage each other.

I cannot test for broken data against a sandbox that might happen to be clean. And
if I build against whatever the sandbox contains, I only handle the cases the
sandbox happens to have.

**What I said no to.** Connecting first and shaping the code around what came back.

**Cost.** About an hour before anything appeared on screen.

**When I would change my mind.** I would not. Of everything here this is the one I
would defend hardest.

*Postscript, added later: the sandbox turned out to have none of those problems.
Zero. I still think this was right, and the reasoning is in the journal.*

---

## 6. Use Remote's MCP to explore, not to build

**The question.** The brief nudges towards Remote's MCP twice. Should the app use it?

**What MCP is.** A way for an AI assistant to connect directly to a system and use
its tools, instead of a developer writing code for each call.

**Chose.** Normal REST API for the application. MCP for exploring while building.

**Why.** Remote's own documentation says the MCP is *"not an API you call
yourself"*. It signs in through a browser and is built for AI chat clients. For a
server calling a server, they recommend the normal API.

A deployed website has no browser and nobody sitting at it to sign in. So building
on MCP would mean using the tool against its stated purpose.

**What I said no to.**
- Ignoring the hint entirely. The brief raises it twice; it deserves an answer.
- Building the app on MCP. It is the flashier choice and the wrong one.

**Cost.** Less immediately impressive than saying "I built it on MCP".

**When I would change my mind.** If the app grew a conversational feature — "who
reports to Sarah?" — where an AI client is genuinely the right shape.

---

## 7. Refresh on a timer instead of fetching when someone visits

**The question.** Should the data be fetched while a visitor waits for the page?

**What I measured first.** 201 employees. The list takes 1.3 seconds. Then one call
per person to get their manager:

| Requests at once | Time for all 201 | Errors |
|---|---|---|
| 4 | 15.6 seconds | 0 |
| 8 | 8.0 seconds | 0 |
| 16 | 5.4 seconds | 0 |

Total for a full refresh: about **7 seconds**.

**Chose.** Build the page in advance and refresh it in the background every five
minutes. Nobody waits for the fetch.

**Why.** Seven seconds is too long to make someone wait, and Vercel cuts a request
off after ten seconds on the free plan. A slow start would push it over. This is
not a preference, it is what the number allows.

**What I said no to.** Fetching on every visit. It would work on a good day and fail
on a slow one, which is the worst kind of bug: intermittent and dependent on load.

**Cost.** The chart can be up to five minutes out of date. The page displays the
exact time it was fetched, so nobody is misled.

**Why I stopped at 16 requests at once.** Zero errors at 16 means I never found the
limit. I could have kept doubling until it broke. I did not, because 5.4 seconds is
already fast enough and this is a shared sandbox the recruiter also uses. I would
say that rather than imply 16 was carefully tuned.

**When I would change my mind.** If the company were ten times bigger. At two
thousand employees this needs a proper scheduled job, not a background refresh.

---

## 8. Show active employees by default, with everyone one click away

**The question.** The sandbox has 201 employment records, but only 171 are active
employees. The rest are archived, invited, or half-created. Who belongs on the
chart?

**The numbers.**

| Which employees | People | At the top |
|---|---|---|
| Everyone | 201 | 45 |
| Active only | 171 | 17 |

23 of those 45 top-level people are archived — former employees whose manager link
was removed when they left.

**Chose.** Show active employees by default. Buttons at the top switch the others
back on.

**Why.** Active-only is the chart a person actually wants to look at. But hiding
thirty employees with no way to see them is exactly the silent-drop problem I argue
against everywhere else in this project. One button keeps it honest, and it doubles
as a live demonstration of the edge-case handling the brief asks for — click
"archived" and watch the top-level count jump from 17 to 45.

**What I said no to.**
- Filtering them out permanently. Thirty people disappear and nobody can tell.
- Showing everyone by default. Forty-five top-level entries including twenty-three
  former employees is noise on first open.

**Cost.** One more thing for the interface to keep track of.

---

## 9. Show the real top-level people, do not invent a boss

**The question.** Seventeen active employees have no manager. A reviewer opening the
page expects to see one person at the top, like a normal org chart. What do I show?

**Chose.** All seventeen, listed with the largest team first, each labelled with why
they are at the top.

**Why.** The two alternatives both mislead.

Putting a made-up "Acme Sandbox Corp" box above all seventeen would make the first
screenshot look like a proper org chart. It would also claim a reporting
relationship that does not exist in the data.

Grouping them under their departments uses real data, but a department is not a
reporting line, so it implies a structure that is not the one being shown.

**Cost.** The first screen is less tidy than a single clean tree. I would rather
explain seventeen top-level people than defend a box I invented.

**When I would change my mind.** If the API exposed a real company root. It does not.

---

## 10. Separate the real teams from the unconnected people

**The question.** Of those seventeen at the top, only five have anyone reporting to
them. The other twelve have no manager *and* no reports — they are attached to
nothing.

**Chose.** Draw the five real teams first. Put the twelve unattached people in their
own section below, with a heading explaining what they are.

**Why.** Before this, a person with twenty-two reports and a person with none were
drawn the same way. Nothing was hidden and every person said why they were at the
top, but you had to read all seventeen rows and count to work out that only five
were real teams.

The shape of this company is the most interesting thing about the data, and the page
was making the reader derive it.

**How this came up.** A reviewer searched for someone and asked why they appeared
alone. Checking the raw data confirmed the chart was right, and showed that twelve
of 171 active employees — seven percent — are attached to nobody.

That is by far the most common edge case here. More common than missing managers and
reporting loops combined, both of which are zero.

**Cost.** One more section on the page.

**Worth saying.** This list is also useful rather than just tidy. For whoever
maintains the company's records, it is a to-do list: these are the twelve people
whose manager field is blank.

---

## 11. Show the whole reporting line, not just the manager

**The question.** The brief asks for "name, title, department, and reporting line".
I had the first three plus the person's immediate manager. Is that the reporting
line?

**Chose.** Show the full chain from the top: *Grace Whitfield › David Chen › Sarah
Chen › this person*.

**Why.** "Reporting line" reads as the whole chain, not one link. It matters most
when you search: you land in the middle of a large team with nothing visible above
you, so you cannot tell where that person sits.

**Detail worth defending.** It only appears from the third level down. One level
down, the chain is just the manager already named on the line above, and printing
the same name twice is clutter.

---

## 12. Ship the decision log with the code

**The question.** Do these notes go in the repository, or stay private?

**Chose.** A trimmed version ships with the code.

**Why.** The brief says plainly that *"using AI tools effectively is a key skill
we're evaluating"*. Most candidates will write one line in their README saying they
used Claude. A decision log written while building, including the places I was
wrong, is a real answer to the question they actually asked.

**Cost.** It shows the process, including ten minutes lost to a test-runner
problem and a prediction about the data that turned out wrong. I think that helps
more than it hurts.
