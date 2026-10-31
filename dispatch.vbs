' dispatch.vbs
' Opens the projects root (the folder holding every project, Dispatch
' included) in VS Code, then opens the Dispatch dashboard in the default
' browser. If nothing is answering on port 3000 yet, the server is
' started first with "npm run dev" in a hidden window, and the browser opens
' once it responds.

Option Explicit

Const DASHBOARD_URL = "http://localhost:3000"
Const STARTUP_TIMEOUT_S = 30
Const POLL_INTERVAL_MS = 500

Dim fso, shell, projectPath, projectsRoot, deadline

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

projectPath = fso.GetParentFolderName(WScript.ScriptFullName)
projectsRoot = fso.GetParentFolderName(projectPath)

' Run through cmd /c so the "code" launcher (a .cmd shim) resolves via PATH.
' Window style 0 = hidden; the shim exits as soon as VS Code has been launched.
shell.Run "cmd /c code """ & projectsRoot & """", 0, False

' Whether the dashboard answers HTTP right now. Any response counts as up;
' only a refused or timed-out connection means the server isn't running.
Function IsServing()
    Dim http
    IsServing = False
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 1000, 1000, 1000, 1000
    http.Open "GET", DASHBOARD_URL & "/", False
    http.Send
    If Err.Number = 0 Then IsServing = True
    On Error GoTo 0
End Function

If Not IsServing() Then
    ' Run through cmd /c so the "npm" launcher (a .cmd shim) resolves via PATH.
    ' Window style 0 = hidden; the server keeps running after this script exits.
    shell.CurrentDirectory = projectPath
    shell.Run "cmd /c npm run dev", 0, False

    deadline = DateAdd("s", STARTUP_TIMEOUT_S, Now)
    Do While Not IsServing()
        If Now > deadline Then
            MsgBox "Dispatch didn't start on " & DASHBOARD_URL & " within " & STARTUP_TIMEOUT_S & " seconds." & vbCrLf & vbCrLf & _
                   "Run ""npm run dev"" in " & projectPath & " to see the error.", vbExclamation, "Dispatch"
            WScript.Quit 1
        End If
        WScript.Sleep POLL_INTERVAL_MS
    Loop
End If

' Running a URL hands it to the default browser.
shell.Run DASHBOARD_URL, 1, False
