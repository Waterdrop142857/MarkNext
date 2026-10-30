; Optional Windows shell integration. Loaded by the MarkNext NSIS template.
!include nsDialogs.nsh
!define MARKNEXT_DOCUMENT_ICON "${__FILEDIR__}\..\icons\markdown.ico"
!define MARKNEXT_MARKDOWN_PROGID "com.marknext.app.Markdown"
!define MARKNEXT_TEXT_PROGID "com.marknext.app.Text"
!define MARKNEXT_CAPABILITIES "Software\MarkNext\Capabilities"
Var MarkNextOpenWith
Var MarkNextOpenWithCheckbox

!macro MARKNEXT_OPEN_WITH_PAGE
  Page custom MarkNextOpenWithPage MarkNextOpenWithPageLeave
!macroend

!macro MARKNEXT_OPEN_WITH_FUNCTIONS
  LangString MarkNextIntegrationTitle ${LANG_ENGLISH} "File opening options"
  LangString MarkNextIntegrationSubtitle ${LANG_ENGLISH} "Choose whether Windows offers MarkNext as an editor."
  LangString MarkNextIntegrationCheckbox ${LANG_ENGLISH} "Add MarkNext to Open with (.md, .markdown, .txt)"
  LangString MarkNextIntegrationDetails ${LANG_ENGLISH} "Your default apps stay unchanged. If you later choose MarkNext as the default for Markdown, its files use the document icon."
  LangString MarkNextIntegrationTitle ${LANG_SIMPCHINESE} "文件打开方式"
  LangString MarkNextIntegrationSubtitle ${LANG_SIMPCHINESE} "选择是否将 MarkNext 添加为 Windows 文件编辑程序。"
  LangString MarkNextIntegrationCheckbox ${LANG_SIMPCHINESE} "将 MarkNext 添加到打开方式（.md、.markdown、.txt）"
  LangString MarkNextIntegrationDetails ${LANG_SIMPCHINESE} "保留当前默认程序。之后若将 MarkNext 设为 Markdown 默认程序，文件将显示独立的文件图标。"

  Function MarkNextLoadOpenWithPreference
    ; Fresh/silent installations do not register without opt-in. Read before
    ; upgrade uninstall so both reinstall and /UPDATE preserve the saved choice.
    StrCpy $MarkNextOpenWith 0
    ReadRegDWORD $0 SHCTX "${MANUPRODUCTKEY}" "OpenWith"
    ${If} $0 == 1
      StrCpy $MarkNextOpenWith 1
    ${EndIf}
    ClearErrors
    ${GetOptions} $CMDLINE "/OPENWITH=" $0
    ${IfNot} ${Errors}
      ${If} $0 == 1
        StrCpy $MarkNextOpenWith 1
      ${ElseIf} $0 == 0
        StrCpy $MarkNextOpenWith 0
      ${Else}
        SetErrorLevel 2
        Abort "Expected /OPENWITH=0 or /OPENWITH=1"
      ${EndIf}
    ${EndIf}
    ClearErrors
  FunctionEnd

  Function MarkNextOpenWithPage
    ${If} $PassiveMode = 1
    ${OrIf} $UpdateMode = 1
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "$(MarkNextIntegrationTitle)" "$(MarkNextIntegrationSubtitle)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 12u 100% 28u "$(MarkNextIntegrationCheckbox)"
    Pop $MarkNextOpenWithCheckbox
    ${NSD_SetState} $MarkNextOpenWithCheckbox $MarkNextOpenWith
    ${NSD_CreateLabel} 0 48u 100% 60u "$(MarkNextIntegrationDetails)"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function MarkNextOpenWithPageLeave
    ${NSD_GetState} $MarkNextOpenWithCheckbox $MarkNextOpenWith
  FunctionEnd
!macroend

!macro MARKNEXT_REGISTER_TYPE PROGID DESCRIPTION
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" '$\"$INSTDIR\markdown.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\${PROGID}\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\Application" "ApplicationIcon" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
!macroend

!macro MARKNEXT_REGISTER_EXTENSION EXT PROGID
  ; Never write .ext's default or Explorer\FileExts\...\UserChoice.
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr SHCTX "${MARKNEXT_CAPABILITIES}\FileAssociations" ".${EXT}" "${PROGID}"
!macroend

!macro MARKNEXT_REMOVE_EXTENSION EXT PROGID
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
!macroend

!macro MARKNEXT_REMOVE_OPEN_WITH
  !insertmacro MARKNEXT_REMOVE_EXTENSION "md" "${MARKNEXT_MARKDOWN_PROGID}"
  !insertmacro MARKNEXT_REMOVE_EXTENSION "markdown" "${MARKNEXT_MARKDOWN_PROGID}"
  !insertmacro MARKNEXT_REMOVE_EXTENSION "txt" "${MARKNEXT_TEXT_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\${MARKNEXT_MARKDOWN_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\${MARKNEXT_TEXT_PROGID}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "MarkNext"
  DeleteRegKey SHCTX "${MARKNEXT_CAPABILITIES}"
  DeleteRegKey /ifempty SHCTX "Software\MarkNext"
!macroend

; Previous Tauri installers used generic ProgIDs and overwrote .ext defaults.
; Migrate only entries whose open command still belongs to this installation;
; leave subsequent choices and other applications' similarly named keys alone.
!macro MARKNEXT_CLEAN_LEGACY_EXTENSION EXT FILECLASS
  ReadRegStr $0 SHCTX "Software\Classes\${FILECLASS}\shell\open\command" ""
  ${If} $0 == '$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\"'
  ${OrIf} $0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    ReadRegStr $1 SHCTX "Software\Classes\.${EXT}" ""
    ${If} $1 == "${FILECLASS}"
      ReadRegStr $1 SHCTX "Software\Classes\.${EXT}" "${FILECLASS}_backup"
      ${If} $1 == ""
      ${OrIf} $1 == "${FILECLASS}"
        DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
      ${Else}
        WriteRegStr SHCTX "Software\Classes\.${EXT}" "" "$1"
      ${EndIf}
    ${EndIf}
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" "${FILECLASS}_backup"
  ${EndIf}
!macroend

!macro MARKNEXT_CLEAN_LEGACY_CLASS FILECLASS
  ReadRegStr $0 SHCTX "Software\Classes\${FILECLASS}\shell\open\command" ""
  ${If} $0 == '$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\"'
  ${OrIf} $0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    DeleteRegKey SHCTX "Software\Classes\${FILECLASS}"
  ${EndIf}
!macroend

!macro MARKNEXT_CLEAN_LEGACY
  !insertmacro MARKNEXT_CLEAN_LEGACY_EXTENSION "md" "Markdown Document"
  !insertmacro MARKNEXT_CLEAN_LEGACY_EXTENSION "markdown" "Markdown Document"
  !insertmacro MARKNEXT_CLEAN_LEGACY_EXTENSION "txt" "Text Document"
  !insertmacro MARKNEXT_CLEAN_LEGACY_CLASS "Markdown Document"
  !insertmacro MARKNEXT_CLEAN_LEGACY_CLASS "Text Document"
!macroend

!macro MARKNEXT_INSTALL_OPEN_WITH
  File /oname=markdown.ico "${MARKNEXT_DOCUMENT_ICON}"
  !insertmacro MARKNEXT_CLEAN_LEGACY
  ${If} $MarkNextOpenWith = 1
    !insertmacro MARKNEXT_REGISTER_TYPE "${MARKNEXT_MARKDOWN_PROGID}" "Markdown Document"
    !insertmacro MARKNEXT_REGISTER_TYPE "${MARKNEXT_TEXT_PROGID}" "Text Document"
    WriteRegStr SHCTX "${MARKNEXT_CAPABILITIES}" "ApplicationName" "${PRODUCTNAME}"
    WriteRegStr SHCTX "${MARKNEXT_CAPABILITIES}" "ApplicationDescription" "Markdown and text editor"
    WriteRegStr SHCTX "${MARKNEXT_CAPABILITIES}" "ApplicationIcon" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
    !insertmacro MARKNEXT_REGISTER_EXTENSION "md" "${MARKNEXT_MARKDOWN_PROGID}"
    !insertmacro MARKNEXT_REGISTER_EXTENSION "markdown" "${MARKNEXT_MARKDOWN_PROGID}"
    !insertmacro MARKNEXT_REGISTER_EXTENSION "txt" "${MARKNEXT_TEXT_PROGID}"
    WriteRegStr SHCTX "Software\RegisteredApplications" "MarkNext" "${MARKNEXT_CAPABILITIES}"
  ${Else}
    !insertmacro MARKNEXT_REMOVE_OPEN_WITH
  ${EndIf}
  WriteRegDWORD SHCTX "${MANUPRODUCTKEY}" "OpenWith" $MarkNextOpenWith
  !insertmacro UPDATEFILEASSOC
!macroend

!macro MARKNEXT_UNINSTALL_OPEN_WITH
  !insertmacro MARKNEXT_REMOVE_OPEN_WITH
  !insertmacro MARKNEXT_CLEAN_LEGACY
  Delete "$INSTDIR\markdown.ico"
  ${If} $UpdateMode <> 1
    DeleteRegValue SHCTX "${MANUPRODUCTKEY}" "OpenWith"
  ${EndIf}
  !insertmacro UPDATEFILEASSOC
!macroend
