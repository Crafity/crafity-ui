#!/bin/sh

export UGLIFYPATH=`which uglifyjs`;

if [[ "$UGLIFYPATH" == "" ]]; then
	echo Installing uglify...
	npm install uglify-js -g;
fi

cat js/lib/jstorage.js js/lib/superagent.js js/lib/momentjs/moment-with-lang.min.js js/lib/numeraljs/min/numeral.min.js js/lib/numeraljs/min/languages.min.js js/crafity.core.js js/crafity.core.EventEmitter.js js/crafity.keyboard.js js/crafity.html.Element.js js/crafity.html.Menu.js js/crafity.html.PasswordField.js js/crafity.html.Searchbox.js js/crafity.Html.List.js js/crafity.Html.Grid.js js/crafity.Html.ButtonBar.js js/crafity.Html.Button.js js/crafity.Html.Form.js js/crafity.Html.Field.js js/crafity.Html.TextField.js js/crafity.Html.DateField.js js/crafity.Html.Selectbox.js js/crafity.Html.MultiSelectbox.js js/crafity.Html.MultiSelectField.js js/crafity.Html.SelectField.js js/crafity.html.ViewContainer.js js/crafity.html.behaviours.js > js/crafity.ui.js

uglifyjs js/crafity.ui.js --compress > js/crafity.ui.min.js
