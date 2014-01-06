/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function SelectField() {
			var self = this;
			crafity.core.mixin(this, html.Field);
			//this[__PROTO__] = new Field();
			this.addClass("selectfield edit");
			this._selectbox = new html.Selectbox();
			this._selectbox.on("selected", function (value) {
				self.emit("selected", value);
			});

			this.options = function (options) {
				if (options === undefined) {
					return this._selectbox.options();
				}
				this._selectbox.options(options);
				return this;

			};

			this.append(this._selectbox);

			// value of the selected option
			this.value = function (value) {
				if (value === undefined) {
					return this._selectbox.value();
				}
				this._selectbox.value(value);
				return this;

			};

			this._isreadonly = false;
			this.readonly = function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly");
					self._selectbox.readonly(true);
					self._selectbox.tabindex("-1");
					self._isreadonly = bool;
				} else if (bool === false) {
					self.addClass("edit").removeClass("readonly");
					self._selectbox.readonly(false);
					self._selectbox.tabindex("0");
					self._isreadonly = bool;
				} else {
					return self._isreadonly;
				}
				return self;
			};
		}

		SelectField.prototype = new html.Element();
		html.SelectField = SelectField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
