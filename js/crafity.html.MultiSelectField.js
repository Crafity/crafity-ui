/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function MultiSelectField() {
			var self = this;
			crafity.core.mixin(this, html.Field);

			this.addClass("multi selectfield edit");
			this._multiSelectbox = this._control = new html.MultiSelectbox();
			this._multiSelectbox.on("selected", function (value) {
				self.verify();
				self.emit("selected", value);
			});

			this.options = function (options) {
				if (options === undefined) {
					return this._multiSelectbox.options();
				}
				this._multiSelectbox.options(options);
				return this;
			};

			this.append(this._multiSelectbox);

			this._isreadonly = false;
			this.readonly = function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly");
					self._multiSelectbox.readonly(true);
					self._multiSelectbox.tabindex("-1");
					self._isreadonly = bool;
				} else if (bool === false) {
					self.addClass("edit").removeClass("readonly");
					self._multiSelectbox.readonly(false);
					self._multiSelectbox.tabindex("0");
					self._isreadonly = bool;
				} else {
					return self._isreadonly;
				}
				return self;
			};
		}

		MultiSelectField.prototype = new html.Element("div");
		html.MultiSelectField = MultiSelectField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
