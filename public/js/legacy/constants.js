// Categories, port numbering and the icons every part of the page draws with.

const CATEGORIES = ["fire", "breeze", "cold"];
const CATEGORY_LIMITS = { fire: 2, breeze: 4 }; // cold is unlimited
const CATEGORY_ICONS = { fire: "🔥", breeze: "🍃", cold: "❄️", unassigned: "📥" };
const BASE_PORT = 3001;
// mynaui:spinner — https://icon-sets.iconify.design/mynaui/spinner/ (MIT), with a
// self-contained rotate animation added since the source icon is static.
const ICON_SPINNER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M12 3v3m6.366-.366l-2.12 2.12M21 12h-3m.366 6.366l-2.12-2.12M12 21v-3m-6.366.366l2.12-2.12M3 12h3m-.366-6.366l2.12 2.12">' +
  '<animateTransform attributeName="transform" type="rotate" dur="0.75s" repeatCount="indefinite" values="0 12 12;360 12 12"/>' +
  "</path></svg>";
// mynaui:dots-vertical — https://icon-sets.iconify.design/mynaui/dots-vertical/ (MIT)
const ICON_MORE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" ' +
  'd="M12.313 12h-.626m.626-5h-.626m.626 10h-.626" />' +
  "</svg>";
// mynaui:play-solid — https://icon-sets.iconify.design/mynaui/play-solid/ (MIT)
const ICON_PLAY_SOLID =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="currentColor" d="m12.503 7.01l-.066-.04c-.748-.455-1.406-.856-1.97-1.058a2.4 2.4 0 0 0-.976-.157a1.8 1.8 0 0 0-.963.37c-.579.434-.829 1.073-.966 1.78c-.133.685-.184 1.577-.247 2.663l-.003.056c-.038.65-.062 1.293-.062 1.876s.024 1.227.062 1.877l.003.055c.063 1.086.114 1.978.247 2.662c.137.708.387 1.346.966 1.781c.286.215.607.343.963.37c.342.025.67-.047.976-.157c.564-.202 1.222-.603 1.97-1.057l.066-.04c.426-.26.844-.527 1.217-.79a24 24 0 0 0 1.335-1.022l.05-.041c.764-.623 1.412-1.152 1.86-1.672c.488-.57.785-1.182.785-1.966s-.297-1.397-.786-1.966c-.447-.52-1.095-1.05-1.858-1.672l-.05-.041c-.454-.37-.91-.724-1.336-1.022a23 23 0 0 0-1.217-.79"/>' +
  "</svg>";
// mynaui:stop-solid — https://icon-sets.iconify.design/mynaui/stop-solid/ (MIT)
const ICON_STOP_SOLID =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="currentColor" d="M11.945 5.75c-1.367 0-2.47 0-3.337.117c-.9.12-1.658.38-2.26.981c-.602.602-.86 1.36-.981 2.26c-.117.867-.117 1.97-.117 3.337v.11c0 1.367 0 2.47.117 3.337c.12.9.38 1.658.981 2.26c.602.602 1.36.86 2.26.982c.867.116 1.97.116 3.337.116h.11c1.367 0 2.47 0 3.337-.116c.9-.122 1.658-.38 2.26-.982s.86-1.36.982-2.26c.116-.867.116-1.97.116-3.337v-.11c0-1.367 0-2.47-.116-3.337c-.122-.9-.38-1.658-.982-2.26s-1.36-.86-2.26-.981c-.867-.117-1.97-.117-3.337-.117z"/>' +
  "</svg>";
// mynaui:check — https://icon-sets.iconify.design/mynaui/check/ (MIT), with a
// self-contained draw-in animation added since the source icon is static.
const ICON_CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" ' +
  'd="M4 12.611l5.688 5.588L20 6.8" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">' +
  '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.3s" fill="freeze"/>' +
  "</path></svg>";
// The same check without ICON_CHECK's drawing animation, for what's redrawn
// with every render() (a finished project's chip).
const ICON_CHECK_STATIC =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M4 12.611l5.688 5.588L20 6.8" />' +
  "</svg>";
// The task ID's copy icon (see buildTaskCodeBadge), same shape as the Raw
// JSON tab's copy button.
const ICON_TASK_COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>' +
  "</svg>";
// mynaui:square — https://icon-sets.iconify.design/mynaui/square/ (MIT)
// Every checkbox's unchecked state (see checkboxIcon).
const ICON_CHECKBOX =
  '<svg xmlns="http://www.w3.org/2000/svg" class="checkbox-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" ' +
  'd="M3 9.4c0-2.24 0-3.36.436-4.216a4 4 0 0 1 1.748-1.748C6.04 3 7.16 3 9.4 3h5.2c2.24 0 3.36 0 4.216.436a4 4 0 0 1 1.748 1.748C21 6.04 21 7.16 21 9.4v5.2c0 2.24 0 3.36-.436 4.216a4 4 0 0 1-1.748 1.748C17.96 21 16.84 21 14.6 21H9.4c-2.24 0-3.36 0-4.216-.436a4 4 0 0 1-1.748-1.748C3 17.96 3 16.84 3 14.6z" />' +
  "</svg>";
// mynaui:check-square-solid — https://icon-sets.iconify.design/mynaui/check-square-solid/ (MIT)
// Every checkbox's checked state (see checkboxIcon). The icon's tick is a
// cutout, so a white square sits behind it — hidden by the fill everywhere
// but through that cutout — to make the tick white instead of whatever
// happens to be behind the checkbox.
const ICON_CHECKBOX_CHECKED =
  '<svg xmlns="http://www.w3.org/2000/svg" class="checkbox-icon checked" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="5" y="5" width="14" height="14" fill="#fff" />' +
  '<path fill="currentColor" ' +
  'd="M9.367 2.25h5.266c1.092 0 1.958 0 2.655.057c.714.058 1.317.18 1.869.46a4.75 4.75 0 0 1 2.075 2.077c.281.55.403 1.154.461 1.868c.057.697.057 1.563.057 2.655v5.266c0 1.092 0 1.958-.057 2.655c-.058.714-.18 1.317-.46 1.869a4.75 4.75 0 0 1-2.076 2.075c-.552.281-1.155.403-1.869.461c-.697.057-1.563.057-2.655.057H9.367c-1.092 0-1.958 0-2.655-.057c-.714-.058-1.317-.18-1.868-.46a4.75 4.75 0 0 1-2.076-2.076c-.281-.552-.403-1.155-.461-1.869c-.057-.697-.057-1.563-.057-2.655V9.367c0-1.092 0-1.958.057-2.655c.058-.714.18-1.317.46-1.868a4.75 4.75 0 0 1 2.077-2.076c.55-.281 1.154-.403 1.868-.461c.697-.057 1.563-.057 2.655-.057m6.406 6.442a.75.75 0 0 0-1.048.169l-3.597 4.981a.25.25 0 0 1-.391.018l-1.506-1.72a.75.75 0 1 0-1.129.987l1.506 1.721a1.75 1.75 0 0 0 2.736-.128l3.597-4.98a.75.75 0 0 0-.168-1.048" />' +
  "</svg>";
// Every radio button's unchecked and checked states (see radioIcon), drawn to
// match the checkboxes above: the same 1.5 stroke for the empty circle, and
// the checked one filled to that circle's outer edge around a white dot.
const ICON_RADIO =
  '<svg xmlns="http://www.w3.org/2000/svg" class="radio-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" />' +
  "</svg>";
const ICON_RADIO_CHECKED =
  '<svg xmlns="http://www.w3.org/2000/svg" class="radio-icon checked" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9.75" fill="currentColor" />' +
  '<circle cx="12" cy="12" r="3.75" fill="#fff" />' +
  "</svg>";
// mynaui:danger-triangle — https://icon-sets.iconify.design/mynaui/danger-triangle/ (MIT)
const ICON_WARNING =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M12 8.5V14m0 3.247v-.5m-6.02-5.985C8.608 5.587 9.92 3 12 3s3.393 2.587 6.02 7.762l.327.644c2.182 4.3 3.274 6.45 2.287 8.022C19.648 21 17.208 21 12.327 21h-.654c-4.88 0-7.321 0-8.307-1.572s.105-3.722 2.287-8.022z" />' +
  "</svg>";
// The panels' empty states (see buildPanelEmpty), each source icon's paths
// joined into one.
// mynaui:search — https://icon-sets.iconify.design/mynaui/search/ (MIT)
const ICON_SEARCH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M19 11.5a7.5 7.5 0 1 1-15 0a7.5 7.5 0 0 1 15 0m-2.107 5.42l3.08 3.08" />' +
  "</svg>";
// mynaui:git-branch — https://icon-sets.iconify.design/mynaui/git-branch/ (MIT)
const ICON_GIT_BRANCH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M6 15a3 3 0 1 1 0 6a3 3 0 0 1 0-6M18 9a3 3 0 1 1 0-6a3 3 0 0 1 0 6m0 0a9 9 0 0 1-9 9m-3-3V3" />' +
  "</svg>";
// mynaui:git-commit — https://icon-sets.iconify.design/mynaui/git-commit/ (MIT)
const ICON_GIT_COMMIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6m-9-3h6m6 0h6" />' +
  "</svg>";
// mynaui:list-check — https://icon-sets.iconify.design/mynaui/list-check/ (MIT)
const ICON_LIST_CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M7.5 16.039L4.688 19.5L3 18.346m4.5-8.077l-2.812 3.462L3 12.577M7.5 4.5L4.688 7.962L3 6.808M11 17.5h10M11 12h10M11 6.5h10" />' +
  "</svg>";
// mynaui:book-open — https://icon-sets.iconify.design/mynaui/book-open/ (MIT)
const ICON_BOOK_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M12 9.8V20m0 0c1.31-1.964 2.192-3 4.57-3h2.832c.559 0 .839 0 1.052-.109c.581-.296.546-.924.546-1.49V6.6c0-1.165-.365-1.6-1.6-1.6h-2.6c-1.68 0-2.52 0-3.162.327C11.892 6.217 12 8.097 12 9.8c0-1.704.107-3.584-1.638-4.473C9.72 5 8.88 5 7.2 5H4.6C3.364 5 3 5.437 3 6.6v8.8c0 .568-.036 1.195.546 1.491c.214.109.493.109 1.052.109H7.43c2.377 0 3.26 1.036 4.569 3" />' +
  "</svg>";
// mynaui:users — https://icon-sets.iconify.design/mynaui/users/ (MIT)
const ICON_USERS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M21 19.75c0-2.09-1.67-5.068-4-5.727m-2 5.727c0-2.651-2.686-6-6-6s-6 3.349-6 6m9-12.5a3 3 0 1 1-6 0a3 3 0 0 1 6 0m3 3a3 3 0 1 0 0-6" />' +
  "</svg>";
// mynaui:user — https://icon-sets.iconify.design/mynaui/user/ (MIT). An
// avatar's stand-in when the person has no picture (see buildAvatar), drawn
// at its own 1.5 stroke since it's shown large.
const ICON_USER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" ' +
  'd="M15 7.5a3 3 0 1 1-6 0a3 3 0 0 1 6 0m4.5 13c-.475-9.333-14.525-9.333-15 0" />' +
  "</svg>";
// mynaui:code-circle — https://icon-sets.iconify.design/mynaui/code-circle/ (MIT)
const ICON_VSCODE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
  '<path d="M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0"/>' +
  '<path d="m14.908 9.7l.132.131c1.022 1.022 1.534 1.534 1.534 2.169s-.512 1.146-1.534 2.169l-.132.132M13.072 8l-2.143 8M9.092 9.7l-.132.131C7.938 10.853 7.427 11.365 7.427 12s.51 1.146 1.533 2.169l.132.132"/>' +
  "</g></svg>";
// mynaui:edit — https://icon-sets.iconify.design/mynaui/edit/ (MIT)
const ICON_EDIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M4 21h16M5.666 13.187A2.28 2.28 0 0 0 5 14.797V18h3.223c.604 0 1.183-.24 1.61-.668l9.5-9.505a2.28 2.28 0 0 0 0-3.22l-.938-.94a2.277 2.277 0 0 0-3.222.001z" />' +
  "</svg>";
// mynaui:eject — https://icon-sets.iconify.design/mynaui/eject/ (MIT)
const ICON_EJECT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M8.386 6.738C9.92 4.858 10.688 3.917 12 3.917s2.08.94 3.614 2.821c.424.52.822 1.035 1.155 1.508c.292.415.593.885.89 1.372c1.14 1.877 1.711 2.815 1.08 3.657c-.633.842-1.955.918-4.6 1.071c-.748.043-1.482.07-2.139.07s-1.39-.027-2.139-.07c-2.645-.153-3.967-.23-4.6-1.071c-.631-.842-.06-1.78 1.08-3.657c.297-.487.599-.957.89-1.372c.332-.473.731-.988 1.155-1.508M5 19h14" />' +
  "</svg>";
// Two opposing arrows, drawn to match ICON_EJECT beside it (18px, 2px
// stroke, round ends) — the project header's Switch button.
const ICON_SWITCH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M4 8h15m0 0l-4-4m4 4l-4 4M20 16H5m0 0l4-4m-4 4l4 4" />' +
  "</svg>";
// lucide:globe — https://lucide.dev/icons/globe (ISC)
const ICON_GLOBE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
  '<circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20" /></g>' +
  "</svg>";
// mynaui:calendar — https://icon-sets.iconify.design/mynaui/calendar/ (MIT)
const ICON_CALENDAR =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" ' +
  'd="M16.5 5V3m-9 2V3M3.25 8h17.5M3 10.044c0-2.115 0-3.173.436-3.981a3.9 3.9 0 0 1 1.748-1.651C6.04 4 7.16 4 9.4 4h5.2c2.24 0 3.36 0 4.216.412c.753.362 1.364.94 1.748 1.65c.436.81.436 1.868.436 3.983v4.912c0 2.115 0 3.173-.436 3.981a3.9 3.9 0 0 1-1.748 1.651C17.96 21 16.84 21 14.6 21H9.4c-2.24 0-3.36 0-4.216-.412a3.9 3.9 0 0 1-1.748-1.65C3 18.128 3 17.07 3 14.955z" />' +
  "</svg>";
// mynaui:chevron-left — https://icon-sets.iconify.design/mynaui/chevron-left/ (MIT)
const ICON_CHEVRON_LEFT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m15 6l-6 6l6 6" />' +
  "</svg>";
// mynaui:chevron-right — https://icon-sets.iconify.design/mynaui/chevron-right/ (MIT)
const ICON_CHEVRON_RIGHT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m9 18l6-6l-6-6" />' +
  "</svg>";
// mynaui:x — https://icon-sets.iconify.design/mynaui/x/ (MIT)
const ICON_DELETE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12" />' +
  "</svg>";
// mynaui:trash — https://icon-sets.iconify.design/mynaui/trash/ (MIT)
const ICON_TRASH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="m18 9l-.84 8.398c-.127 1.273-.19 1.909-.48 2.39a2.5 2.5 0 0 1-1.075.973C15.098 21 14.46 21 13.18 21h-2.36c-1.279 0-1.918 0-2.425-.24a2.5 2.5 0 0 1-1.076-.973c-.288-.48-.352-1.116-.48-2.389L6 9m7.5 6.5v-5m-3 5v-5m-6-4h4.615m0 0l.386-2.672c.112-.486.516-.828.98-.828h3.038c.464 0 .867.342.98.828l.386 2.672m-5.77 0h5.77m0 0H19.5" />' +
  "</svg>";
// The staff card's three actions (see buildStaffMenu): a bubble, a lock
// and a circle, so they tell apart at a glance, even from afar. Adjusted
// from mynaui so they read as one size side by side: each scaled from 18
// units tall to 16, centered in the 24-unit box.
// mynaui:lock — https://icon-sets.iconify.design/mynaui/lock/ (MIT); scaled
// to 8/9 about the center.
const ICON_LOCK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M8.444 10.222V8.444c0-2.454 1.101-4.444 3.556-4.444s3.556 1.99 3.556 4.444v1.778M4.444 17.156v-4.089c0-.996 0-1.493 .194-1.873a1.778 1.778 0 0 1 .777-.778c.38-.193 .878-.193 1.874-.193h9.422c.996 0 1.493 0 1.874 .193a1.778 1.778 0 0 1 .777 .777c.194 .38 .194 .878 .194 1.874v4.089c0 .996 0 1.493-.194 1.874a1.778 1.778 0 0 1-.777 .777C18.204 20 17.707 20 16.711 20H7.289c-.996 0-1.493 0-1.874-.194a1.778 1.778 0 0 1-.777-.777C4.444 18.65 4.444 18.152 4.444 17.156" />' +
  "</svg>";
// mynaui:chat-dots — https://icon-sets.iconify.design/mynaui/chat-dots/ (MIT);
// scaled to 8/9 about the center.
const ICON_CHAT_DOTS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M12 12.667v-.444m3.556 .444v-.444m-7.111 .444v-.444M12 20a8 8 0 1 0-8-8c0 1.28.3 2.489.836 3.562c.403.81-.157 1.902-.371 2.7a1.04 1.04 0 0 0 1.274 1.274c.797-.213 1.89-.773 2.7-.37A8 8 0 0 0 12 20" />' +
  "</svg>";
// mynaui:minus-circle — https://icon-sets.iconify.design/mynaui/minus-circle/
// (MIT); scaled to 8/9 about the center.
const ICON_MINUS_CIRCLE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M20 12a8 8 0 1 1-16 0a8 8 0 0 1 16 0M8.889 12h6.222" />' +
  "</svg>";
// mynaui:archive — https://icon-sets.iconify.design/mynaui/archive/ (MIT)
const ICON_ARCHIVE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M10.5 11.5h3M20 8v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8m17 0V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3z" />' +
  "</svg>";
// ICON_ARCHIVE with its slot swapped for an arrow pointing out of the box.
const ICON_UNARCHIVE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M12 17.5v-6m-2.5 2.5l2.5-2.5l2.5 2.5M20 8v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8m17 0V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3z" />' +
  "</svg>";
// Two arrows chasing each other: the project header's Sync, and a failed
// panel's Try again (see buildLoadErrorEmpty).
const ICON_REFRESH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M4 12a8 8 0 0 1 14.5-4.5M18 3v4.5h-4.5M20 12a8 8 0 0 1-14.5 4.5M6 21v-4.5h4.5" />' +
  "</svg>";
// The same + as public/js/app/ui.js's.
const ICON_PLUS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14" />' +
  "</svg>";
// mynaui:folder — https://icon-sets.iconify.design/mynaui/folder/ (MIT)
const ICON_FOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M3 8.5c0-1.886 0-2.828.586-3.414S5.114 4.5 7 4.5h1.643c1.108 0 1.663 0 2.148.257c.485.256.81.732 1.46 1.684l.5.732c.245.358.367.537.53.664c.082.063.171.116.266.157c.19.081.404.096.833.106c2.145.055 3.218.083 3.928.716q.101.09.192.19c.633.71.661 1.783.716 3.928l.034 1.317c.06 2.313.09 3.469-.6 4.194s-1.883.725-4.208.725H7c-1.886 0-2.828 0-3.414-.586S3 17.386 3 15.5z" />' +
  "</svg>";
// mynaui:file — https://icon-sets.iconify.design/mynaui/file/ (MIT)
const ICON_FILE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M14 3.4V7c0 1.886 0 2.828.586 3.414S16.114 11 18 11h3.4M4 11.5V8c0-2.828 0-4.243.879-5.121C5.757 2 7.172 2 10 2h2.343c.818 0 1.226 0 1.594.152c.367.153.657.442 1.235 1.022L18.826 6.83c.578.579.868.868 1.02 1.235c.153.368.153.777.153 1.595V16c0 2.828 0 4.243-.879 5.121C18.243 22 16.828 22 14 22h-4c-2.828 0-4.243 0-5.121-.879C4 20.243 4 18.828 4 16z" />' +
  "</svg>";
// mynaui:image — https://icon-sets.iconify.design/mynaui/image/ (MIT)
const ICON_FILE_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none"/>' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 16.5l-5.4-5.4a2 2 0 0 0-2.83 0L3 20.5"/>' +
  "</svg>";
// mynaui:video — https://icon-sets.iconify.design/mynaui/video/ (MIT)
const ICON_FILE_VIDEO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="2" y="6" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 10.5l4.553-2.276A1 1 0 0 1 22 9.118v5.764a1 1 0 0 1-1.447.894L16 13.5"/>' +
  "</svg>";
// mynaui:music — https://icon-sets.iconify.design/mynaui/music/ (MIT)
const ICON_FILE_AUDIO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 18V5l11-2v13"/>' +
  '<circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<circle cx="17" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
  "</svg>";
// mynaui:code — https://icon-sets.iconify.design/mynaui/code/ (MIT)
const ICON_FILE_CODE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 8l-4 4 4 4m6-8l4 4-4 4"/>' +
  "</svg>";
// mynaui:braces — https://icon-sets.iconify.design/mynaui/braces/ (MIT), for
// data/config files (json, yaml, xml, env...) — matches how file explorers
// conventionally show those with a "{}" glyph rather than a plain document.
// Moved down 1 unit so it's centered in its box like the other file icons
// (it spanned 3.5–18.5, sitting high beside its file name).
const ICON_FILE_DATA =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 4.5c-1.5 0-2.5 1-2.5 2.5v3c0 1-.5 1.5-1.5 2c1 .5 1.5 1 1.5 2v3c0 1.5 1 2.5 2.5 2.5"/>' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 4.5c1.5 0 2.5 1 2.5 2.5v3c0 1 .5 1.5 1.5 2c-1 .5-1.5 1-1.5 2v3c0 1.5-1 2.5-2.5 2.5"/>' +
  "</svg>";
// mynaui:archive — https://icon-sets.iconify.design/mynaui/archive/ (MIT)
const ICON_FILE_ARCHIVE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v2.5m0 3v2m0 2v2m0 2v.5"/>' +
  "</svg>";
// mynaui:hash — https://icon-sets.iconify.design/mynaui/hash/ (MIT), moved up
// half a unit so it's centered in its box like the other file icons.
const ICON_FILE_MARKDOWN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.697 3.5L6.678 20.5M17.054 3.5l-3.019 17M21 8.281H3m18 7.438H3"/>' +
  "</svg>";
// mynaui:code-solid — https://icon-sets.iconify.design/mynaui/code-solid/ (MIT)
const ICON_FILE_CODE_SOLID =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="currentColor" d="M16.56 7.444a.75.75 0 0 1 1.06 0l.23.23l.038.038c.862.862 1.563 1.563 2.04 2.19c.5.652.826 1.312.826 2.098s-.327 1.446-.825 2.099c-.478.626-1.179 1.327-2.04 2.189l-.27.268a.75.75 0 1 1-1.06-1.06l.23-.23c.91-.91 1.538-1.54 1.947-2.077c.397-.52.518-.863.518-1.19c0-.325-.121-.668-.518-1.188c-.41-.537-1.037-1.167-1.947-2.077l-.23-.23a.75.75 0 0 1 0-1.06M14.07 4.276a.75.75 0 0 1 .53.918l-3.75 14a.75.75 0 0 1-1.45-.388l3.752-14a.75.75 0 0 1 .918-.53M7.441 7.444a.75.75 0 0 1 0 1.06l-.23.23c-.91.91-1.537 1.54-1.947 2.077c-.397.52-.517.863-.517 1.189s.12.67.517 1.189c.41.537 1.037 1.167 1.947 2.076l.23.23a.75.75 0 1 1-1.06 1.061l-.269-.268c-.862-.862-1.563-1.563-2.04-2.19c-.499-.652-.825-1.312-.825-2.098s.326-1.446.824-2.099c.478-.626 1.179-1.327 2.041-2.189l.269-.268a.75.75 0 0 1 1.06 0"/>' +
  "</svg>";
// Extension -> icon category, for the Explorer panel's per-file-type icons.
// Anything not listed here (plain text, lockfiles, dotfiles not covered
// below, extensionless files...) falls back to the generic ICON_FILE.
const FILE_ICON_EXTENSIONS = {
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif", "tiff", "tif", "heic", "heif"],
  video: ["mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "m4v", "mpg", "mpeg"],
  audio: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"],
  data: ["json", "yml", "yaml", "toml", "xml", "csv", "env"],
  markdown: ["md", "markdown"],
  code: [
    "js", "jsx", "ts", "tsx", "mjs", "cjs", "html", "htm", "css", "scss", "sass", "less",
    "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp", "cs", "php", "sh", "bash", "ps1",
    "sql", "vue", "svelte", "lua", "swift", "kt", "dart",
  ],
  script: ["ejs", "vbs"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
};
const FILE_ICON_BY_CATEGORY = {
  image: ICON_FILE_IMAGE,
  video: ICON_FILE_VIDEO,
  audio: ICON_FILE_AUDIO,
  data: ICON_FILE_DATA,
  markdown: ICON_FILE_MARKDOWN,
  code: ICON_FILE_CODE,
  script: ICON_FILE_CODE_SOLID,
  archive: ICON_FILE_ARCHIVE,
};

function iconForFileName(name) {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  for (const category in FILE_ICON_EXTENSIONS) {
    if (FILE_ICON_EXTENSIONS[category].includes(ext)) return FILE_ICON_BY_CATEGORY[category];
  }
  return ICON_FILE;
}
