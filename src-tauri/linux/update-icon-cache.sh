#!/bin/sh
# Called by DEB/RPM after installation/removal. Respect the active icon theme;
# these files only extend its hicolor fallback and do not change MIME defaults.
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || :
fi
exit 0
