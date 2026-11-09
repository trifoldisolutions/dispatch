# Trifoldi Projects

Dispatch writes this file from `dispatch/config/projects_root/AGENTS.template.md` each time it starts, so edits belong there.

Each folder here is one project with its own `AGENTS.md`: follow that file when working in it. Two folders aren't projects: `scripts/` holds a shared helper, and `new_project_sample/` shows what a new project starts with.

**New projects start from Dispatch (hard rule).** Never make a project folder by hand, and never copy `new_project_sample/`. Create it on the Dispatch dashboard (http://localhost:3000), or with `POST http://localhost:3000/api/project-folders/<name>`, which makes the folder with its `AGENTS.md` and `dev_resources/init_prompt.md`. If the dashboard isn't running, say so and ask. The project then needs a port from Dispatch before its init prompt can finish.
