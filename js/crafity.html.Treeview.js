/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function Treeview() {}
		Treeview.prototype = new html.Element("div");
		
		html.Treeview = Treeview;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
