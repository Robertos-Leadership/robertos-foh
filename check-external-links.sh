#!/usr/bin/env bash
# check-external-links.sh — audit every outside link/service the Events module
# hands to guests or the team. Run before shipping: catches dead payment links,
# broken functions, missing PDFs — the class of bug a code-only test can't see.
#
#   bash check-external-links.sh
#
SITE="${1:-https://robertos-foh-dev.pages.dev}"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhb2Fpdnd0a3p1am1yZ3JmanVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzAxMzAsImV4cCI6MjA5NjY0NjEzMH0.VynG9PBeIaqRG2lkMEuzskkcB11EhR-UfO9eGYsaUxk"
FN="https://paoaivwtkzujmrgrfjuq.supabase.co/functions/v1"
fail=0
chk(){ # label  expected  actual
  if [ "$2" = "$3" ]; then echo "  OK   $1 ($3)"; else echo "  FAIL $1 — expected $2, got $3"; fail=1; fi
}
code(){ curl -s -o /dev/null -w "%{http_code}" -L "$@"; }

echo "Auditing $SITE"
chk "index.html"                  200 "$(code "$SITE/")"
chk "client-agreement page"       200 "$(code "$SITE/client-agreement.html?t=demo")"
chk "client-event page"           200 "$(code "$SITE/client-event.html?t=demo")"
chk "set-menu PDF (Terra)"        200 "$(code "$SITE/menus/set-menu-terra.pdf")"
chk "set-menu PDF (Mare)"         200 "$(code "$SITE/menus/set-menu-mare.pdf")"
chk "set-menu PDF (Fuoco)"        200 "$(code "$SITE/menus/set-menu-fuoco.pdf")"
chk "WhatsApp deep link"          200 "$(code "https://wa.me/971500000000")"
chk "Payment gateway (contract)"  200 "$(code "https://robertosrestaurants.com/dubai/payment-gateway/pg-telr-advance-payment")"
chk "event-agreement fn (bad tok)" 404 "$(code "$FN/event-agreement?t=x")"
chk "event-client-menu fn (bad tok)" 400 "$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$FN/event-client-menu?t=x")"

echo ""
if [ "$fail" = "0" ]; then echo "ALL LINKS OK"; else echo "SOME LINKS BROKEN — fix before shipping to guests."; fi
exit $fail
