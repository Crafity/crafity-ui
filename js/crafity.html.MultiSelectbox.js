/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {
		var EMPTY_SELECT_VALUE = " ";
		
		function MultiSelectbox() {
			var self = this;

			this._selectedValue = new html.Element("span").text(EMPTY_SELECT_VALUE);
			this.append(this._selectedValue);

			this._optionList = new html.Element("div");
			this.append(this._optionList);
			
			this._options = [];
			this.addClass("multi selectbox edit");
			this.tabindex("0");

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly").tabindex("-1");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly").tabindex(null);
				}
			});
		}
		
		MultiSelectbox.prototype = new html.Element("div");
		MultiSelectbox.prototype.options = function (options) {
			var self = this;
			if (options === undefined) {
				//return self._optionList.options();
				return self;
			}
			Object.keys(options).forEach(function (key) {
				self.append(new html.Element("div").text(options[key]));
			});
			//self._optionList.options(options);
			return self;

		};
		html.MultiSelectbox = MultiSelectbox;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
