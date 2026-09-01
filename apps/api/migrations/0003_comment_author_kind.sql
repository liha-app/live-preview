-- Who wrote a comment: a person, or an agent acting through a tool.
--
-- The product's claim is that an agent joins the review rather than reading a
-- transcript of it. That is only visible if an agent's contribution looks like
-- an agent's contribution — until now a reply from Claude and a reply from a
-- designer differed by the name typed in a box.
--
-- Declared by the caller, like the author name, and shown as such. The WebMCP
-- tools and the MCP server set it; the browser composer does not. It is a
-- label, not a credential.
ALTER TABLE comments ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'human'
  CHECK (author_kind IN ('human', 'agent'));
